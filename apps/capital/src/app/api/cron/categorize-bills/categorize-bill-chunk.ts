import type { PrismaClient } from "@/generated/prisma";
import {
  categorizeBillTransactions,
  type CategorizationResult,
} from "@capital/server/lib/claude";
import { BILL_LABEL_KEYS } from "@capital/server/lib/category-prompt";
import { getSystemCategoryNames } from "@capital/server/modules/categories/lib/system-categories";
import { internalCategoryName } from "@capital/server/modules/categories/lib/internal-category";
import { normalizeDescription } from "@capital/server/modules/credit-cards/utils";

// One chunk per invocation. Matches the Claude batch size in claude.ts so each
// run makes a single Claude API call (~5-15s).
export const BILL_CATEGORIZE_CHUNK_SIZE = 50;

type BillCategorizer = typeof categorizeBillTransactions;

export type BillChunkOutcome =
  | {
      kind: "already-done";
      billId: string;
    }
  | {
      kind: "chunk";
      billId: string;
      processedInThisRun: number;
      remaining: number;
      status: "completed" | "processing";
    };

/**
 * Categorize the next chunk of a bill the route has already claimed.
 * Ordering, chunk size, and the Uncategorized progress marker match the route.
 */
export async function categorizeClaimedBillChunk(
  db: PrismaClient,
  input: {
    billId: string;
    userId: string;
    categorize?: BillCategorizer;
  }
): Promise<BillChunkOutcome> {
  const categorize = input.categorize ?? categorizeBillTransactions;

  // Pull the next chunk of uncategorized transactions for this bill.
  // Progress marker is `category === "Uncategorized"`: once a transaction
  // gets a real category (manual or AI), it falls out of this query, so
  // subsequent cron runs naturally pick up the next chunk.
  const chunk = await db.billTransaction.findMany({
    where: {
      billId: input.billId,
      category: "Uncategorized",
    },
    select: {
      id: true,
      description: true,
      merchantName: true,
      amount: true,
    },
    orderBy: { createdAt: "asc" },
    take: BILL_CATEGORIZE_CHUNK_SIZE,
  });

  if (chunk.length === 0) {
    await db.creditCardBill.update({
      where: { id: input.billId },
      data: { categorizationStatus: "completed" },
    });
    return { kind: "already-done", billId: input.billId };
  }

  const categories = await db.category.findMany({
    where: { userId: input.userId, type: "expense" },
    select: { name: true, isArchived: true },
  });
  const labels = await getSystemCategoryNames(input.userId, BILL_LABEL_KEYS, db);
  const otherName = await internalCategoryName(input.userId, "other_system", db);
  const categoryNames = [
    ...new Set([
      ...categories.filter((c) => !c.isArchived).map((c) => c.name),
      otherName,
    ]),
  ];

  const txInput = chunk.map((t, i) => ({
    index: i,
    description: t.description,
    merchantName: t.merchantName ?? undefined,
    amount: t.amount,
  }));

  const categorizations: CategorizationResult[] = await categorize(
    txInput,
    categoryNames,
    otherName,
    labels
  );

  const validCategorizations = categorizations.filter(
    (cat) => chunk[cat.index] !== undefined
  );

  await db.$transaction(
    validCategorizations.map((cat) => {
      const tx = chunk[cat.index];
      return db.billTransaction.update({
        where: { id: tx.id },
        data: {
          category: cat.category,
          isAutoCategorized: true,
        },
      });
    })
  );

  for (const cat of validCategorizations) {
    const tx = chunk[cat.index];
    if (cat.category === otherName) continue;
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
      update: { category: cat.category },
      create: {
        userId: input.userId,
        normalizedDescription: normalized,
        category: cat.category,
        source: "ai",
      },
    });
  }

  const remaining = await db.billTransaction.count({
    where: {
      billId: input.billId,
      category: "Uncategorized",
    },
  });

  const isDone = remaining === 0;
  if (isDone) {
    await db.creditCardBill.update({
      where: { id: input.billId },
      data: { categorizationStatus: "completed" },
    });
  }

  return {
    kind: "chunk",
    billId: input.billId,
    processedInThisRun: chunk.length,
    remaining,
    status: isDone ? "completed" : "processing",
  };
}
