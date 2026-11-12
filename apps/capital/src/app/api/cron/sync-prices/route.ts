import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron } from "@capital/server/lib/cron";
import { syncPricesStage } from "@capital/server/modules/market-data/services/market-close";

/**
 * The market-close pipeline's first stage on its own, for a manual rerun.
 * Not scheduled: /api/cron/market-close runs it daily. Writes today's close
 * for every active Asset through the market-data registry's provider chain.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "sync-prices" }, () => syncPricesStage(prisma));
}
