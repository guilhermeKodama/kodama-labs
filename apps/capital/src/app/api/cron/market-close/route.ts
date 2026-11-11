import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCronPipeline } from "@capital/server/lib/cron";
import { portfolioSnapshotStage, syncPricesStage, updatePricesStage } from "@capital/server/modules/market-data/services/market-close";

/**
 * Daily at 22:30 UTC (infrastructure/cronjobs/schedules/capital.json): the
 * day's closes into AssetPrice, then every holding's cached price, then each
 * entity's portfolio snapshot — in order, each recorded as its own
 * IntegrationRun job. See services/market-close.ts.
 */
export async function GET(request: NextRequest) {
  return withCronPipeline(request, [
    { job: "sync-prices", run: () => syncPricesStage(prisma) },
    { job: "update-prices", run: () => updatePricesStage(prisma) },
    { job: "portfolio-snapshot", run: () => portfolioSnapshotStage(prisma) },
  ]);
}
