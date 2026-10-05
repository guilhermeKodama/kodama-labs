import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Every 15 minutes: sends the notifications that are due in each user's
 * timezone (bill closed, budget threshold, weekly summary), once per
 * NotificationDispatch key. Stub until the notification senders land.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, todo: "notification senders (bill_closed, budget_threshold, weekly_summary)" });
}
