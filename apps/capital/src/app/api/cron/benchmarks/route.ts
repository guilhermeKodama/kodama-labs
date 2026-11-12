import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { refreshBenchmarks } from "@capital/server/modules/investments/services/benchmarks";

/**
 * Caches the benchmark series in MarketIndexValue (CDI from BCB SGS 12,
 * IPCA from SGS 433) for "Rentab. 12m".
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "benchmarks" }, async (): Promise<CronRunResult> => {
    const series = await refreshBenchmarks(prisma);
    const failed = series.filter((s) => s.error);
    if (failed.length) console.error("[Benchmarks] failed series:", failed);
    const status: CronRunResult["status"] = failed.length === 0 ? "ok" : failed.length === series.length ? "failed" : "partial";
    return {
      status,
      requested: series.length,
      succeeded: series.length - failed.length,
      rejected: failed.length,
      error: failed.map((s) => `${s.series}: ${s.error}`).join("; ") || null,
      stats: series,
      body: { series },
    };
  });
}
