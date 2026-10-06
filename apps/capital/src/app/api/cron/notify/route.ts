import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { runNotifications } from "@capital/server/modules/notifications/services/notify";
import { env } from "@/env";

/**
 * Every 15 minutes: sends the notifications that are due in each user's
 * timezone (card bill closed, budget threshold, weekly summary), once per
 * NotificationDispatch key. Recurring-bill reminders have their own cron
 * (/api/cron/send-reminders).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotifications(prisma);
    return NextResponse.json({ success: true, processedAt: new Date().toISOString(), ...result });
  } catch (error) {
    console.error("Error sending notifications:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
