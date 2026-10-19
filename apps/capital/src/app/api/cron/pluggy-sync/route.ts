import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { prisma } from "@capital/server/lib/prisma";
import { isPluggyConfigured } from "@capital/server/modules/pluggy/lib/config";
import { createPluggyClient } from "@capital/server/modules/pluggy/lib/client";
import { anthropicIncomeGuesser } from "@capital/server/modules/pluggy/lib/guesser";
import { syncPluggy } from "@capital/server/modules/pluggy/services/sync";

/**
 * Daily. Reads the Meu Pluggy snapshot for every saved item. With the
 * credentials unset this is a no-op: the rest of Capital is unchanged.
 * Meu Pluggy refreshes itself; this job does not ask the bank again.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPluggyConfigured()) {
    return NextResponse.json({ success: true, status: "disabled", message: "Pluggy is not configured" });
  }
  try {
    const users = await prisma.pluggyItem.findMany({ distinct: ["userId"], select: { userId: true } });
    const results = [];
    for (const user of users) {
      results.push(await syncPluggy(user.userId, { db: prisma, client: createPluggyClient(), now: new Date(), guesser: anthropicIncomeGuesser() }, { trigger: "cron" }));
    }
    return NextResponse.json({ success: true, status: results.length ? "ok" : "idle", users: results.length, processedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[Pluggy] Cron failed:", error instanceof Error ? error.message : "sync failed");
    return NextResponse.json({ success: false, error: "Pluggy sync failed", processedAt: new Date().toISOString() }, { status: 500 });
  }
}
