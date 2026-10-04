import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeClaimedBillChunk } from "./categorize-bill-chunk";

/**
 * Cron endpoint that processes pending bill categorizations via Claude API.
 * Runs every 2 minutes. Processes one chunk of transactions per run; the bill
 * stays in "processing" until all its uncategorized transactions are done.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find the oldest bill that still has work to do. "processing" bills come
    // first when they're older — that's the correct behavior since we want to
    // finish in-progress bills before starting new ones.
    const pendingBill = await prisma.creditCardBill.findFirst({
      where: {
        categorizationStatus: { in: ["pending", "processing"] },
      },
      include: {
        creditCard: {
          select: {
            id: true,
            personalAccountId: true,
            businessId: true,
            personalAccount: { select: { userId: true } },
            business: { select: { userId: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!pendingBill) {
      return NextResponse.json({
        success: true,
        message: "No pending bills to categorize",
        processedAt: new Date().toISOString(),
      });
    }

    // Mark as processing (idempotent if already processing)
    if (pendingBill.categorizationStatus !== "processing") {
      await prisma.creditCardBill.update({
        where: { id: pendingBill.id },
        data: { categorizationStatus: "processing" },
      });
    }

    try {
      const userId =
        pendingBill.creditCard.personalAccount?.userId ??
        pendingBill.creditCard.business?.userId;

      if (!userId) {
        throw new Error("Could not determine user for bill");
      }

      const chunkResult = await categorizeClaimedBillChunk(prisma, {
        billId: pendingBill.id,
        userId,
      });

      if (chunkResult.kind === "already-done") {
        return NextResponse.json({
          success: true,
          message: `Bill ${pendingBill.id} already fully categorized`,
          processedAt: new Date().toISOString(),
          result: {
            billId: pendingBill.id,
            processedInThisRun: 0,
            remaining: 0,
            status: "completed",
          },
        });
      }

      const isDone = chunkResult.status === "completed";
      return NextResponse.json({
        success: true,
        message: isDone
          ? `Finished categorizing bill ${pendingBill.id}`
          : `Categorized chunk of bill ${pendingBill.id}`,
        processedAt: new Date().toISOString(),
        result: {
          billId: pendingBill.id,
          processedInThisRun: chunkResult.processedInThisRun,
          remaining: chunkResult.remaining,
          status: chunkResult.status,
        },
      });
    } catch (error) {
      console.error(`Failed to categorize bill ${pendingBill.id}:`, error);

      // Mark as failed
      await prisma.creditCardBill.update({
        where: { id: pendingBill.id },
        data: { categorizationStatus: "failed" },
      });

      return NextResponse.json({
        success: false,
        message: `Failed to categorize bill ${pendingBill.id}`,
        processedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
        result: {
          billId: pendingBill.id,
          status: "failed",
        },
      });
    }
  } catch (error) {
    console.error("Error in categorize-bills cron:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
