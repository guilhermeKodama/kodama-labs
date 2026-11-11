import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { syncPrices } from "@capital/server/modules/market-data/services/sync-prices";

/**
 * Daily, vendor-agnostic price sync for the global Asset layer: every
 * active Asset with a source ref gets today's close written to AssetPrice
 * via the market-data registry's provider chain (brapi, Yahoo, CoinGecko
 * today). update-prices (the older cron) then just reads AssetPrice into
 * each holding's cache — it no longer calls a provider itself.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "sync-prices" }, async (): Promise<CronRunResult> => {
    const result = await syncPrices(prisma);
    const status: CronRunResult["status"] =
      result.requested === 0 ? "skipped" : result.priced + result.suspect === 0 ? "failed" : result.missing > 0 ? "partial" : "ok";
    return {
      status,
      requested: result.requested,
      succeeded: result.priced + result.suspect,
      missing: result.missing,
      rejected: result.issues.filter((i) => i.outcome === "rejected").length,
      providerLatestDate: result.providerLatestDate,
      stats: { bySource: result.bySource, suspect: result.suspect, issues: result.issues },
      body: { message: `Synced prices for ${result.priced + result.suspect}/${result.requested} assets`, ...result },
    };
  });
}
