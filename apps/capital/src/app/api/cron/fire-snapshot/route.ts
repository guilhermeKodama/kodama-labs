import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { recordMonthlySnapshots } from "@capital/server/modules/fire/services/record-monthly-snapshots";

/**
 * Monthly cron: on the 1st of each month, snapshot every user's FIRE progress
 * for the month that just ended. Runs unattended — progress accrues without any
 * manual clicking.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "fire-snapshot" }, async (): Promise<CronRunResult> => {
    const now = new Date();
    // First day of the previous month (the month that just ended).
    const prevFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12));
    const year = prevFirst.getUTCFullYear();
    const month = prevFirst.getUTCMonth() + 1; // 1-12
    const period = year * 100 + month;
    const snapshotDate = new Date(Date.UTC(year, month, 0, 12)); // last day of that month

    const result = await recordMonthlySnapshots(prisma, { period, snapshotDate });
    return {
      status: result.total === 0 ? "skipped" : result.recorded === 0 ? "failed" : result.recorded < result.total ? "partial" : "ok",
      requested: result.total,
      succeeded: result.recorded,
      body: { period, ...result },
    };
  });
}
