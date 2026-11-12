import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { runNotifications } from "@capital/server/modules/notifications/services/notify";

/**
 * Every 15 minutes: sends the notifications that are due in each user's
 * timezone (card bill closed, budget threshold, weekly summary, a linked
 * holding gone stale), once per NotificationDispatch key. Recurring-bill
 * reminders have their own cron (/api/cron/send-reminders).
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "notify" }, async (): Promise<CronRunResult> => {
    const result = await runNotifications(prisma);
    const status: CronRunResult["status"] = result.skipped ? "skipped" : result.failed > 0 && result.sent === 0 ? "failed" : result.failed > 0 ? "partial" : "ok";
    return {
      status,
      requested: result.users,
      succeeded: result.sent,
      rejected: result.failed,
      stats: { claimed: result.claimed, alreadySent: result.alreadySent, errors: result.errors },
      body: { ...result },
    };
  });
}
