import type { PrismaClient } from "@/generated/prisma";
import { categorizeStatementTransactions } from "@capital/server/lib/claude";
import { STATEMENT_LABEL_KEYS } from "@capital/server/lib/category-prompt";
import { getSystemCategoryNames } from "@capital/server/modules/categories/lib/system-categories";
import { internalCategoryName } from "@capital/server/modules/categories/lib/internal-category";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";

type StatementCategorizer = typeof categorizeStatementTransactions;

/**
 * Categorize one statement import the route has already claimed.
 * Loads every uncategorized row for that import, with no extra ordering.
 */
export async function categorizeClaimedStatementImport(
  db: PrismaClient,
  input: {
    importId: string;
    userId: string;
    categorize?: StatementCategorizer;
  }
): Promise<{ transactionCount: number }> {
  const categorize = input.categorize ?? categorizeStatementTransactions;

  const transactions = await db.transaction.findMany({
    where: {
      statementImportId: input.importId,
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
    const categories = await db.category.findMany({
      where: { userId: input.userId },
      select: { name: true, type: true, isArchived: true },
    });
    const labels = await getSystemCategoryNames(input.userId, STATEMENT_LABEL_KEYS, db);
    const otherExpense = await internalCategoryName(input.userId, "other_system", db);
    const otherIncome = await internalCategoryName(input.userId, "other_income", db);
    const visible = categories.filter((c) => !c.isArchived);
    const expenseCategories = [
      ...new Set([
        ...visible.filter((c) => c.type === "expense").map((c) => c.name),
        otherExpense,
      ]),
    ];
    const incomeCategories = [
      ...new Set([
        ...visible.filter((c) => c.type === "income").map((c) => c.name),
        otherIncome,
      ]),
    ];

    const expenseTxs = transactions.filter((t) => t.type === "expense");
    const incomeTxs = transactions.filter((t) => t.type === "income");

    const updates: Array<{ id: string; category: string }> = [];

    if (expenseTxs.length > 0) {
      const txInput = expenseTxs.map((t, i) => ({
        index: i,
        description: t.description,
        amount: t.amount,
      }));

      const results = await categorize(
        txInput,
        expenseCategories,
        "expense",
        otherExpense,
        labels
      );
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

      const results = await categorize(
        txInput,
        incomeCategories,
        "income",
        otherIncome,
        labels
      );
      for (const r of results) {
        const tx = incomeTxs[r.index];
        if (tx) updates.push({ id: tx.id, category: r.category });
      }
    }

    if (updates.length > 0) {
      await db.$transaction(
        updates.map((u) =>
          db.transaction.update({
            where: { id: u.id },
            data: { category: u.category },
          })
        )
      );

      for (const u of updates) {
        if (u.category === otherExpense || u.category === otherIncome) continue;
        const tx = transactions.find((t) => t.id === u.id);
        if (!tx) continue;

        const normalized = normalizeDescription(tx.description);
        const existing = await db.merchantCategoryMapping.findUnique({
          where: {
            userId_normalizedDescription: {
              userId: input.userId,
              normalizedDescription: normalized,
            },
          },
          select: { source: true },
        });
        if (existing?.source === "manual") continue;

        await db.merchantCategoryMapping.upsert({
          where: {
            userId_normalizedDescription: {
              userId: input.userId,
              normalizedDescription: normalized,
            },
          },
          update: { category: u.category },
          create: {
            userId: input.userId,
            normalizedDescription: normalized,
            category: u.category,
            source: "ai",
          },
        });
      }
    }
  }

  return { transactionCount: transactions.length };
}
