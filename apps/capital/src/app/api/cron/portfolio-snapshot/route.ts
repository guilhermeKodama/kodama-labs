import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { runPortfolioSnapshots } from "@capital/server/modules/investments/services/portfolio-history";

/**
 * Daily (23:30 UTC): upserts each entity's PortfolioSnapshot for the current
 * month at today's prices and closes the previous month once the month
 * turns. See services/portfolio-history.ts.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPortfolioSnapshots(prisma);
    if (result.errors.length) console.error("[PortfolioSnapshot] failed users:", result.errors);
    return NextResponse.json({ success: result.errors.length === 0, ...result, processedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[PortfolioSnapshot] Cron failed:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error", processedAt: new Date().toISOString() }, { status: 500 });
  }
}
