import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeClaimedStatementImport } from "./categorize-statement-import";

export const maxDuration = 60;

/**
 * Cron endpoint that processes pending statement import categorizations via Claude API.
 * Processes 1 import per run.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pendingImport = await prisma.statementImport.findFirst({
      where: {
        categorizationStatus: { in: ["pending", "processing"] },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!pendingImport) {
      return NextResponse.json({
        success: true,
        message: "No pending statement imports to categorize",
        processedAt: new Date().toISOString(),
      });
    }

    await prisma.statementImport.update({
      where: { id: pendingImport.id },
      data: { categorizationStatus: "processing" },
    });

    try {
      const userId = pendingImport.userId;
      const categorized = await categorizeClaimedStatementImport(prisma, {
        importId: pendingImport.id,
        userId,
      });

      await prisma.statementImport.update({
        where: { id: pendingImport.id },
        data: { categorizationStatus: "completed" },
      });

      return NextResponse.json({
        success: true,
        message: `Categorized statement import ${pendingImport.id}`,
        processedAt: new Date().toISOString(),
        result: {
          importId: pendingImport.id,
          transactionCount: categorized.transactionCount,
          status: "completed",
        },
      });
    } catch (error) {
      console.error(`Failed to categorize statement import ${pendingImport.id}:`, error);

      await prisma.statementImport.update({
        where: { id: pendingImport.id },
        data: { categorizationStatus: "failed" },
      });

      return NextResponse.json({
        success: false,
        message: `Failed to categorize statement import ${pendingImport.id}`,
        processedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } catch (error) {
    console.error("Error in categorize-statements cron:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
