import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { categorizeStatementTransactions } from "@capital/server/lib/claude";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";

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

      // Fetch transactions that need categorization
      const transactions = await prisma.transaction.findMany({
        where: {
          statementImportId: pendingImport.id,
          category: "Uncategorized",
        },
        select: {
          id: true,
          description: true,
          amount: true,
          type: true,
        },
      });

      if (transactions.length > 0) {
        // Fetch user's categories (both expense and income)
        const categories = await prisma.category.findMany({
          where: { userId },
          select: { name: true, type: true },
        });
        const expenseCategories = [...new Set(categories.filter((c) => c.type === "expense").map((c) => c.name))];
        const incomeCategories = [...new Set(categories.filter((c) => c.type === "income").map((c) => c.name))];

        // Split by type for better categorization
        const expenseTxs = transactions.filter((t) => t.type === "expense");
        const incomeTxs = transactions.filter((t) => t.type === "income");

        const updates: Array<{ id: string; category: string }> = [];

        if (expenseTxs.length > 0) {
          const txInput = expenseTxs.map((t, i) => ({
            index: i,
            description: t.description,
            amount: t.amount,
          }));

          const results = await categorizeStatementTransactions(txInput, expenseCategories, "expense");
          for (const r of results) {
            const tx = expenseTxs[r.index];
            if (tx) updates.push({ id: tx.id, category: r.category });
          }
        }

        if (incomeTxs.length > 0) {
          const txInput = incomeTxs.map((t, i) => ({
            index: i,
            description: t.description,
            amount: t.amount,
          }));

          const results = await categorizeStatementTransactions(txInput, incomeCategories, "income");
          for (const r of results) {
            const tx = incomeTxs[r.index];
            if (tx) updates.push({ id: tx.id, category: r.category });
          }
        }

        // Batch update transaction categories
        if (updates.length > 0) {
          await prisma.$transaction(
            updates.map((u) =>
              prisma.transaction.update({
                where: { id: u.id },
                data: { category: u.category },
              })
            )
          );

          // Save learned mappings
          for (const u of updates) {
            if (u.category === "Other" || u.category === "Other Income") continue;
            const tx = transactions.find((t) => t.id === u.id);
            if (!tx) continue;

            const normalized = normalizeDescription(tx.description);
            const existing = await prisma.merchantCategoryMapping.findUnique({
              where: {
                userId_normalizedDescription: { userId, normalizedDescription: normalized },
              },
              select: { source: true },
            });
            if (existing?.source === "manual") continue;

            await prisma.merchantCategoryMapping.upsert({
              where: {
                userId_normalizedDescription: { userId, normalizedDescription: normalized },
              },
              update: { category: u.category },
              create: {
                userId,
                normalizedDescription: normalized,
                category: u.category,
                source: "ai",
              },
            });
          }
        }
      }

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
          transactionCount: transactions.length,
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
