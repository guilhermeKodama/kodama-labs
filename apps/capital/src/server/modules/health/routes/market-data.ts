import type { AssetClass } from "@/generated/prisma";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { ASSET_CLASSES } from "@capital/server/modules/investments/lib/allocation-class";
import { holdingPriceStatus, PRICE_STALE_AFTER_SESSIONS, type PriceStatus } from "@capital/server/modules/investments/lib/quotes";
import { activeProviderFor, activeProviders, brapiHasToken } from "@capital/server/modules/market-data/lib/registry";

/**
 * GET /health/market-data: the one place a cron that "ran but changed
 * nothing" (see src/server/lib/cron.ts) becomes visible without reading
 * logs. Uptime Kuma polls this (infrastructure/monitoring/src/spec.ts) so a
 * broken price or FX feed pages instead of leaving the portfolio silently
 * stale; the data-health panel in Settings reads the same shape.
 *
 * Job freshness comes from IntegrationRun (one row per cron run); holding
 * freshness is a second opinion straight from InvestmentHolding, since a
 * job can report "ok" while still missing most of its tickers.
 */

const router = createRouter();

interface JobTarget {
  job: string;
  /** Hours since the last run before this job counts as "degraded". Matches its schedule plus a little slack. */
  targetHours: number;
}

/** Schedules: infrastructure/cronjobs/schedules/capital.json. The first three are stages of the one daily market-close pipeline (22:30 UTC), so they share its target. */
const JOBS: JobTarget[] = [
  { job: "sync-prices", targetHours: 26 }, // daily, market-close stage 1
  { job: "update-prices", targetHours: 26 }, // daily, market-close stage 2
  { job: "portfolio-snapshot", targetHours: 26 }, // daily, market-close stage 3
  { job: "update-rates", targetHours: 3 }, // hourly
  { job: "benchmarks", targetHours: 30 }, // daily
  { job: "pluggy-sync", targetHours: 30 }, // daily
];

/** Twice the target with no successful run at all is "down", not just "degraded". */
const DOWN_MULTIPLIER = 2;

export type JobStatus = "ok" | "degraded" | "down";

export interface JobHealth {
  job: string;
  status: JobStatus;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  ageHours: number | null;
  targetHours: number;
}

/**
 * Pure: no DB, so it is unit-tested directly rather than through
 * IntegrationRun, which every test touching the real cron routes shares
 * (there is no per-test namespace for a job name the way MarketIndexValue's
 * `series` or a ledger fixture's userId have one).
 */
export function evaluateJobStatus(
  last: { status: string; startedAt: Date; finishedAt: Date | null } | null,
  targetHours: number,
  now: number,
): { status: JobStatus; ageHours: number | null } {
  if (!last) return { status: "down", ageHours: null };
  const ageMs = now - (last.finishedAt ?? last.startedAt).getTime();
  const ageHours = ageMs / 3_600_000;
  const fresh = ageHours <= targetHours;
  if (last.status === "failed" && !fresh) return { status: "down", ageHours };
  if (ageHours > targetHours * DOWN_MULTIPLIER) return { status: "down", ageHours };
  if (!fresh || last.status === "partial" || last.status === "failed") return { status: "degraded", ageHours };
  return { status: "ok", ageHours };
}

/** Pure: the worst of the per-job statuses. */
export function overallStatus(jobs: { status: JobStatus }[]): JobStatus {
  if (jobs.some((j) => j.status === "down")) return "down";
  if (jobs.some((j) => j.status === "degraded")) return "degraded";
  return "ok";
}

export interface AssetClassHealth {
  total: number;
  priceable: number;
  fresh: number;
  stale: number;
  unpriced: number;
  unsupported: number;
  noTicker: number;
  /** The registry's current pick for this class (chainFor()[0].id), or null when nothing prices it. Pure read, no network call. */
  activeProvider: string | null;
}

/**
 * Configuration facts worth a line on the panel, not a degraded status: a
 * source running without its credential still prices through the rest of the
 * chain. "brapi_no_token": brapi is in the chain without BRAPI_TOKEN, so B3
 * goes to Yahoo first and brapi only answers its demo tickers.
 */
export type MarketDataNotice = "brapi_no_token";

export function marketDataNotices(): MarketDataNotice[] {
  const notices: MarketDataNotice[] = [];
  if (!brapiHasToken() && activeProviders().some((p) => p.id === "brapi")) notices.push("brapi_no_token");
  return notices;
}

function emptyClassHealth(assetClass: AssetClass): AssetClassHealth {
  return { total: 0, priceable: 0, fresh: 0, stale: 0, unpriced: 0, unsupported: 0, noTicker: 0, activeProvider: activeProviderFor(assetClass)?.id ?? null };
}

router.get("/health/market-data", async (c) => {
  const now = Date.now();

  const jobs: JobHealth[] = await Promise.all(
    JOBS.map(async ({ job, targetHours }) => {
      // Scheduled runs only: a manual "Atualizar cotações" (trigger "manual") for one user's assets says nothing about the daily job.
      const last = await prisma.integrationRun.findFirst({ where: { job, trigger: "cron" }, orderBy: { startedAt: "desc" } });
      const { status, ageHours } = evaluateJobStatus(last, targetHours, now);
      return {
        job,
        status,
        lastRunAt: (last?.finishedAt ?? last?.startedAt)?.toISOString() ?? null,
        lastRunStatus: last?.status ?? null,
        ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
        targetHours,
      };
    }),
  );

  const holdings = await prisma.investmentHolding.findMany({
    where: { isActive: true },
    select: { ticker: true, assetClass: true, currentPrice: true, lastPriceUpdate: true },
  });
  const nowDate = new Date(now);
  const byStatus: Record<PriceStatus, number> = { fresh: 0, stale: 0, unpriced: 0, unsupported: 0, no_ticker: 0 };
  const byAssetClass = new Map<AssetClass, AssetClassHealth>(ASSET_CLASSES.map((ac) => [ac, emptyClassHealth(ac)]));
  let oldestPriceAt: Date | null = null;
  for (const h of holdings) {
    const status = holdingPriceStatus(h, nowDate);
    byStatus[status]++;
    const classHealth = byAssetClass.get(h.assetClass)!;
    classHealth.total++;
    if (status === "no_ticker") classHealth.noTicker++;
    else classHealth[status]++;
    if (status !== "no_ticker" && status !== "unsupported") classHealth.priceable++;
    if (h.lastPriceUpdate && (!oldestPriceAt || h.lastPriceUpdate < oldestPriceAt)) oldestPriceAt = h.lastPriceUpdate;
  }
  // "Priceable" is what a source could price today, whatever its ticker or class.
  const priceable = holdings.length - byStatus.no_ticker - byStatus.unsupported;

  const overall = overallStatus(jobs);
  return c.json(
    {
      status: overall,
      jobs,
      notices: marketDataNotices(),
      holdings: {
        total: holdings.length,
        priceable,
        stale: byStatus.stale,
        byStatus,
        byAssetClass: Object.fromEntries(byAssetClass),
        oldestPriceAt: oldestPriceAt?.toISOString() ?? null,
        staleAfterSessions: PRICE_STALE_AFTER_SESSIONS,
      },
    },
    overall === "down" ? 503 : 200,
  );
});

export default router;
