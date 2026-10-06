import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { refreshBenchmarks } from "@capital/server/modules/investments/services/benchmarks";

/**
 * Daily (10:00 UTC): caches the benchmark series in MarketIndexValue (CDI
 * from BCB SGS 12, IPCA from SGS 433) for "Rentab. 12m".
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const series = await refreshBenchmarks(prisma);
  const failed = series.filter((s) => s.error);
  if (failed.length) console.error("[Benchmarks] failed series:", failed);
  return NextResponse.json({ success: failed.length === 0, series, processedAt: new Date().toISOString() }, { status: failed.length === series.length ? 502 : 200 });
}
