import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Daily: upserts each entity's PortfolioSnapshot for the current month and
 * closes the previous one when the month turns. Stub until the portfolio
 * history lands.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, todo: "portfolio snapshots (live month upsert, previous month close)" });
}
