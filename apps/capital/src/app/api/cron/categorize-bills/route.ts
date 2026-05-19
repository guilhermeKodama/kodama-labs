import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeBillTransactions } from "@capital/server/lib/claude";
import { normalizeDescription } from "@capital/server/modules/credit-cards/utils";

// Allow up to 60 seconds for this function (Pro plan supports up to 300s)
export const maxDuration = 60;

// One chunk per invocation. Matches the Claude batch size in claude.ts so each
// run makes a single Claude API call (~5-15s) and stays well under maxDuration.
const CHUNK_SIZE = 50;

/**
 * Cron endpoint that processes pending bill categorizations via Claude API.
 * Runs every 2 minutes. Processes one chunk of transactions per run; the bill
 * stays in "processing" until all its uncategorized transactions are done.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
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

      // Pull the next chunk of uncategorized transactions for this bill.
      // Progress marker is `category === "Uncategorized"`: once a transaction
      // gets a real category (manual or AI), it falls out of this query, so
      // subsequent cron runs naturally pick up the next chunk.
      const chunk = await prisma.billTransaction.findMany({
        where: {
          billId: pendingBill.id,
          category: "Uncategorized",
        },
        select: {
          id: true,
          description: true,
          merchantName: true,
          amount: true,
        },
        orderBy: { createdAt: "asc" },
        take: CHUNK_SIZE,
      });

      if (chunk.length === 0) {
        // Nothing left to categorize for this bill — mark completed.
        await prisma.creditCardBill.update({
          where: { id: pendingBill.id },
          data: { categorizationStatus: "completed" },
        });
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

      // Fetch user's expense categories
      const categories = await prisma.category.findMany({
        where: { userId, type: "expense" },
        select: { name: true },
      });
      const categoryNames = [...new Set(categories.map((c) => c.name))];

      const txInput = chunk.map((t, i) => ({
        index: i,
        description: t.description,
        merchantName: t.merchantName ?? undefined,
        amount: t.amount,
      }));

      const categorizations = await categorizeBillTransactions(
        txInput,
        categoryNames
      );

      const validCategorizations = categorizations.filter(
        (cat) => chunk[cat.index] !== undefined
      );

      await prisma.$transaction(
        validCategorizations.map((cat) => {
          const tx = chunk[cat.index];
          return prisma.billTransaction.update({
            where: { id: tx.id },
            data: {
              category: cat.category,
              isAutoCategorized: true,
            },
          });
        })
      );

      // Save learned mappings (AI won't overwrite manual ones)
      for (const cat of validCategorizations) {
        const tx = chunk[cat.index];
        if (cat.category === "Other") continue;
        const normalized = normalizeDescription(tx.description);
        const existing = await prisma.merchantCategoryMapping.findUnique({
          where: {
            userId_normalizedDescription: {
              userId,
              normalizedDescription: normalized,
            },
          },
          select: { source: true },
        });
        if (existing?.source === "manual") continue;
        await prisma.merchantCategoryMapping.upsert({
          where: {
            userId_normalizedDescription: {
              userId,
              normalizedDescription: normalized,
            },
          },
          update: { category: cat.category },
          create: {
            userId,
            normalizedDescription: normalized,
            category: cat.category,
            source: "ai",
          },
        });
      }

      // Did we exhaust the bill? If yes, mark completed; otherwise leave it as
      // "processing" so the next cron run picks up the next chunk.
      const remaining = await prisma.billTransaction.count({
        where: {
          billId: pendingBill.id,
          category: "Uncategorized",
        },
      });

      const isDone = remaining === 0;
      if (isDone) {
        await prisma.creditCardBill.update({
          where: { id: pendingBill.id },
          data: { categorizationStatus: "completed" },
        });
      }

      return NextResponse.json({
        success: true,
        message: isDone
          ? `Finished categorizing bill ${pendingBill.id}`
          : `Categorized chunk of bill ${pendingBill.id}`,
        processedAt: new Date().toISOString(),
        result: {
          billId: pendingBill.id,
          processedInThisRun: chunk.length,
          remaining,
          status: isDone ? "completed" : "processing",
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
