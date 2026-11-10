import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { holdingPriceStatus, PRICE_STALE_HOURS, type PriceStatus } from "@capital/server/modules/investments/lib/quotes";

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

/** Schedules: infrastructure/cronjobs/schedules/capital.json. */
const JOBS: JobTarget[] = [
  { job: "update-prices", targetHours: 8 }, // every 6h
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

router.get("/health/market-data", async (c) => {
  const now = Date.now();

  const jobs: JobHealth[] = await Promise.all(
    JOBS.map(async ({ job, targetHours }) => {
      const last = await prisma.integrationRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } });
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
  let oldestPriceAt: Date | null = null;
  for (const h of holdings) {
    byStatus[holdingPriceStatus(h, nowDate)]++;
    if (h.lastPriceUpdate && (!oldestPriceAt || h.lastPriceUpdate < oldestPriceAt)) oldestPriceAt = h.lastPriceUpdate;
  }
  // "Priceable" is what a source could price today, whatever its ticker or class.
  const priceable = holdings.length - byStatus.no_ticker - byStatus.unsupported;

  const overall = overallStatus(jobs);
  return c.json(
    {
      status: overall,
      jobs,
      holdings: {
        total: holdings.length,
        priceable,
        stale: byStatus.stale,
        byStatus,
        oldestPriceAt: oldestPriceAt?.toISOString() ?? null,
        staleAfterHours: PRICE_STALE_HOURS,
      },
    },
    overall === "down" ? 503 : 200,
  );
});

export default router;
