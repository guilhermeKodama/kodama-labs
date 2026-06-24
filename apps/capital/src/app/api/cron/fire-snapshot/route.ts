import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { recordMonthlySnapshots } from "@capital/server/modules/fire/services/record-monthly-snapshots";

export const maxDuration = 60;

/**
 * Monthly cron: on the 1st of each month, snapshot every user's FIRE progress
 * for the month that just ended. Runs unattended — progress accrues without any
 * manual clicking.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    // First day of the previous month (the month that just ended).
    const prevFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12));
    const year = prevFirst.getUTCFullYear();
    const month = prevFirst.getUTCMonth() + 1; // 1-12
    const period = year * 100 + month;
    const snapshotDate = new Date(Date.UTC(year, month, 0, 12)); // last day of that month

    const result = await recordMonthlySnapshots(prisma, { period, snapshotDate });

    return NextResponse.json({
      success: true,
      period,
      ...result,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[FireSnapshot] Cron failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        processedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
