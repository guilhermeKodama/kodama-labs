import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Daily: caches the benchmark series in MarketIndexValue (CDI from BCB SGS
 * 12, IPCA from SGS 433). Stub until the benchmark fetcher lands.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, todo: "benchmark series (CDI, IPCA)" });
}
