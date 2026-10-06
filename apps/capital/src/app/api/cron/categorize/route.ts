import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizePendingEntries } from "@capital/server/modules/categories/services/ai-categorize";

/**
 * Every 2 minutes: categorizes one chunk of imported bank rows and card
 * purchases that are still uncategorized, oldest first. Replaces the
 * separate bill and statement categorizers.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await categorizePendingEntries(prisma);
    return NextResponse.json({ success: true, processedAt: new Date().toISOString(), ...result });
  } catch (error) {
    console.error("Error in categorize cron:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
