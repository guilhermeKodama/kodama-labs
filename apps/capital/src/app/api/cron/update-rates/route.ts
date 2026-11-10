import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { updateAllCurrencyRates } from "@capital/server/modules/currencies/services/update-rates-from-api";

/**
 * Refreshes the automatic currency rates (PTAX on a BRL base, the ECB
 * otherwise) of users with fxAutoUpdate on. Rates a user typed are left
 * alone (see updateAllCurrencyRates).
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "update-rates" }, async (): Promise<CronRunResult> => {
    const result = await updateAllCurrencyRates(prisma);
    const succeeded = result.ratesUpdated + result.ratesUnchanged;
    const status: CronRunResult["status"] =
      result.ratesRequested === 0 ? "skipped" : result.errors === 0 ? "ok" : succeeded === 0 ? "failed" : "partial";
    return {
      status,
      requested: result.ratesRequested,
      succeeded,
      rejected: result.errors,
      stats: result,
      body: { message: `Updated ${result.ratesUpdated} rates for ${result.usersProcessed} users`, ...result },
    };
  });
}
