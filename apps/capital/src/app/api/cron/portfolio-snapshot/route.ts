import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron } from "@capital/server/lib/cron";
import { portfolioSnapshotStage } from "@capital/server/modules/market-data/services/market-close";

/**
 * The market-close pipeline's last stage on its own, for a manual rerun.
 * Not scheduled: /api/cron/market-close runs it daily, after the holdings'
 * prices are refreshed. Upserts each entity's PortfolioSnapshot for the
 * current month and closes the previous one once the month turns.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "portfolio-snapshot" }, () => portfolioSnapshotStage(prisma));
}
