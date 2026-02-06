import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeBillTransactions } from "@capital/server/lib/claude";

/**
 * Cron endpoint that processes pending bill categorizations via Claude API.
 * Runs every 2 minutes on Vercel.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find bills with pending categorization
    const pendingBills = await prisma.creditCardBill.findMany({
      where: { categorizationStatus: "pending" },
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
          },
        },
      },
      take: 5, // Process max 5 bills per cron run to stay within time limits
    });

    if (pendingBills.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending bills to categorize",
        processedAt: new Date().toISOString(),
      });
    }

    const results: Array<{
      billId: string;
      transactionCount: number;
      status: string;
    }> = [];

    for (const bill of pendingBills) {
      // Mark as processing
      await prisma.creditCardBill.update({
        where: { id: bill.id },
        data: { categorizationStatus: "processing" },
      });

      try {
        // Get the user ID from the credit card's entity
        const userId =
          bill.creditCard.personalAccount?.userId ??
          bill.creditCard.business?.userId;

        if (!userId) {
          throw new Error("Could not determine user for bill");
        }

        // Fetch user's expense categories
        const categories = await prisma.category.findMany({
          where: { userId, type: "expense" },
          select: { name: true },
        });
        const categoryNames = [...new Set(categories.map((c) => c.name))];

        // Prepare transactions for categorization
        const txInput = bill.billTransactions.map((t, i) => ({
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

        // Update each transaction's category
        for (const cat of categorizations) {
          const tx = bill.billTransactions[cat.index];
          if (tx) {
            await prisma.billTransaction.update({
              where: { id: tx.id },
              data: {
                category: cat.category,
                isAutoCategorized: true,
              },
            });
          }
        }

        // Mark as completed
        await prisma.creditCardBill.update({
          where: { id: bill.id },
          data: { categorizationStatus: "completed" },
        });

        results.push({
          billId: bill.id,
          transactionCount: bill.billTransactions.length,
          status: "completed",
        });
      } catch (error) {
        console.error(`Failed to categorize bill ${bill.id}:`, error);

        // Mark as failed
        await prisma.creditCardBill.update({
          where: { id: bill.id },
          data: { categorizationStatus: "failed" },
        });

        results.push({
          billId: bill.id,
          transactionCount: bill.billTransactions.length,
          status: "failed",
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} bill(s)`,
      processedAt: new Date().toISOString(),
      results,
    });
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
