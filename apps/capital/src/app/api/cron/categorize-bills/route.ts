import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeBillTransactions } from "@capital/server/lib/claude";

// Allow up to 60 seconds for this function (Pro plan supports up to 300s)
export const maxDuration = 60;

/**
 * Cron endpoint that processes pending bill categorizations via Claude API.
 * Runs every 2 minutes on Vercel. Processes 1 bill per run to stay within limits.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find ONE bill with pending categorization (process one at a time to stay within limits)
    // Find bills that need categorization: "pending" or stuck in "processing" (from a previous timeout)
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
        billTransactions: {
          select: {
            id: true,
            description: true,
            merchantName: true,
            amount: true,
            category: true,
            isAutoCategorized: true,
          },
        },
      },
      orderBy: { createdAt: "asc" }, // Process oldest first
    });

    if (!pendingBill) {
      return NextResponse.json({
        success: true,
        message: "No pending bills to categorize",
        processedAt: new Date().toISOString(),
      });
    }

    // Mark as processing
    await prisma.creditCardBill.update({
      where: { id: pendingBill.id },
      data: { categorizationStatus: "processing" },
    });

    try {
      // Get the user ID from the credit card's entity
      const userId =
        pendingBill.creditCard.personalAccount?.userId ??
        pendingBill.creditCard.business?.userId;

      if (!userId) {
        throw new Error("Could not determine user for bill");
      }

      // Fetch user's expense categories
      const categories = await prisma.category.findMany({
        where: { userId, type: "expense" },
        select: { name: true },
      });
      const categoryNames = [...new Set(categories.map((c) => c.name))];

      // Filter out transactions that already have manual categories
      // (preserved from a previous bill upload or manually edited by the user)
      const transactionsToCategorizе = pendingBill.billTransactions.filter(
        (t) => t.category === "Uncategorized" || t.isAutoCategorized
      );

      if (transactionsToCategorizе.length > 0) {
        // Prepare transactions for categorization
        const txInput = transactionsToCategorizе.map((t, i) => ({
          index: i,
          description: t.description,
          merchantName: t.merchantName ?? undefined,
          amount: t.amount,
        }));

        // Call Claude API
        const categorizations = await categorizeBillTransactions(
          txInput,
          categoryNames
        );

        // Batch update only the transactions that need categorization
        await prisma.$transaction(
          categorizations
            .filter((cat) => {
              const tx = transactionsToCategorizе[cat.index];
              return tx !== undefined;
            })
            .map((cat) => {
              const tx = transactionsToCategorizе[cat.index];
              return prisma.billTransaction.update({
                where: { id: tx.id },
                data: {
                  category: cat.category,
                  isAutoCategorized: true,
                },
              });
            })
        );
      }

      // Mark as completed
      await prisma.creditCardBill.update({
        where: { id: pendingBill.id },
        data: { categorizationStatus: "completed" },
      });

      return NextResponse.json({
        success: true,
        message: `Categorized bill ${pendingBill.id}`,
        processedAt: new Date().toISOString(),
        result: {
          billId: pendingBill.id,
          transactionCount: pendingBill.billTransactions.length,
          status: "completed",
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
          transactionCount: pendingBill.billTransactions.length,
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
