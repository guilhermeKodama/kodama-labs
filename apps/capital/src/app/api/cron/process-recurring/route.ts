import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { processDueRules } from "@capital/server/modules/recurring/services/recurring-rules";
import { purgeTrash } from "@capital/server/modules/ledger/services/entries";

const TRASH_RETENTION_DAYS = 30;

/**
 * Daily: books every due occurrence of auto-generating recurring rules
 * (income, expenses and transfers) and empties trash older than 30 days.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recurring = await processDueRules(prisma);
    const trash = await purgeTrash(prisma, TRASH_RETENTION_DAYS);
    return NextResponse.json({ success: true, processedAt: new Date().toISOString(), recurring, trash });
  } catch (error) {
    console.error("Error processing recurring rules:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
