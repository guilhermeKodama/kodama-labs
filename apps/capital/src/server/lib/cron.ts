import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "./prisma";

/**
 * One wrapper for every scheduled integration route (market prices, FX
 * rates, benchmarks, Pluggy): authentication that fails closed, one
 * IntegrationRun row per run, and a status code the cron runner and Uptime
 * Kuma can trust.
 *
 * Before this, a route answered 200 even when it fetched nothing (see
 * update-prices and update-rates), so the push heartbeat stayed green while
 * the portfolio never moved. "ok" and "skipped" are a 200; "partial" is a
 * 200 with `degraded: true` in the body, so the cron still succeeds (the
 * heartbeat fires) but a human or GET /api/health/market-data can see it
 * limped; "failed" is a 503, so the cron runner logs it and Uptime Kuma's
 * push monitor does NOT get a heartbeat for this run (see
 * infrastructure/cronjobs/src/heartbeat.ts: it only ever pushes on success).
 */

export type CronStatus = "ok" | "partial" | "failed" | "skipped";

export interface CronRunResult {
  status: CronStatus;
  /** Provider within the job, when it fans out to more than one source. */
  provider?: string | null;
  /** How many items the job considered. */
  requested?: number | null;
  succeeded?: number | null;
  missing?: number | null;
  rejected?: number | null;
  /** The newest date the provider actually returned, when that is meaningful. */
  providerLatestDate?: Date | null;
  error?: string | null;
  /** Free-form breakdown, stored as-is in IntegrationRun.stats. */
  stats?: unknown;
  /** Extra fields merged into the JSON response body (kept for existing callers of the route). */
  body?: Record<string, unknown>;
}

export interface WithCronOptions {
  /** Stable job key, matched by GET /api/health/market-data and the data-health panel. */
  job: string;
  trigger?: "cron" | "manual";
}

const STATUS_HTTP: Record<CronStatus, number> = { ok: 200, skipped: 200, partial: 200, failed: 503 };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Runs `run()` behind the shared cron secret, records an IntegrationRun and
 * returns the mapped HTTP response. `run` should never throw on an expected
 * failure (a provider being down, say) and report it in the returned
 * status instead; a thrown error is still caught and recorded as "failed",
 * but loses whatever partial progress the job made.
 */
export async function withCron(request: NextRequest, opts: WithCronOptions, run: () => Promise<CronRunResult>): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  // Fails closed: with no secret configured, every request is unauthorized.
  // A route used to accept any caller when CRON_SECRET was unset.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return unauthorized();

  const startedAt = new Date();
  let result: CronRunResult;
  try {
    result = await run();
  } catch (error) {
    console.error(`[Cron] ${opts.job} threw:`, error);
    result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  const finishedAt = new Date();

  console.log(`[Cron] ${opts.job} ${result.status}`, {
    provider: result.provider ?? undefined,
    requested: result.requested ?? undefined,
    succeeded: result.succeeded ?? undefined,
    missing: result.missing ?? undefined,
    rejected: result.rejected ?? undefined,
    error: result.error ?? undefined,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });

  await prisma.integrationRun
    .create({
      data: {
        job: opts.job,
        provider: result.provider ?? null,
        trigger: opts.trigger ?? "cron",
        status: result.status,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        requested: result.requested ?? null,
        succeeded: result.succeeded ?? null,
        missing: result.missing ?? null,
        rejected: result.rejected ?? null,
        providerLatestDate: result.providerLatestDate ?? null,
        error: result.error ?? null,
        stats: (result.stats ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    // A run log write failing must never fail the run itself, or mask its real result.
    .catch((error) => console.error(`[Cron] ${opts.job}: failed to record IntegrationRun:`, error));

  return NextResponse.json(
    {
      success: result.status === "ok" || result.status === "skipped",
      status: result.status,
      degraded: result.status === "partial" || undefined,
      ...result.body,
      ...(result.error ? { error: result.error } : {}),
      processedAt: finishedAt.toISOString(),
    },
    { status: STATUS_HTTP[result.status] },
  );
}
