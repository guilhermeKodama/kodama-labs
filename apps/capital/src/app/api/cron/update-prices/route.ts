import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron } from "@capital/server/lib/cron";
import { updatePricesStage } from "@capital/server/modules/market-data/services/market-close";

/**
 * The market-close pipeline's second stage on its own, for a manual rerun.
 * Not scheduled: /api/cron/market-close runs it daily, right after
 * sync-prices. Refreshes every holding's cached price from AssetPrice — no
 * provider call.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "update-prices" }, () => updatePricesStage(prisma));
}
