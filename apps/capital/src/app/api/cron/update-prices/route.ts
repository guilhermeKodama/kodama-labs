import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { updateAllPrices } from "@capital/server/modules/investments/services/update-prices";

/**
 * Fetches current market prices for all ticker-based holdings.
 * Uses CoinGecko (crypto), brapi.dev (Brazilian B3), and Yahoo Finance (international).
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "update-prices" }, async (): Promise<CronRunResult> => {
    const result = await updateAllPrices(prisma);
    // Holdings with no ticker or whose class no source prices yet (fixed income, savings)
    // were never attempted, so a portfolio that is entirely those is "skipped", not "failed".
    const unattempted = result.issues.filter((i) => i.reason === "no_ticker" || i.reason === "no_source").length;
    const attempted = result.totalHoldings - unattempted;
    const status: CronRunResult["status"] =
      attempted === 0 ? "skipped" : result.updated === 0 ? "failed" : result.missing.length > 0 || result.failed > 0 ? "partial" : "ok";
    return {
      status,
      requested: attempted,
      succeeded: result.updated,
      missing: result.missing.length,
      rejected: result.failed,
      providerLatestDate: result.latestQuoteAt ? new Date(result.latestQuoteAt) : null,
      stats: { bySource: result.bySource, issues: result.issues },
      body: { message: `Updated prices for ${result.updated}/${result.totalHoldings} holdings`, ...result },
    };
  });
}
