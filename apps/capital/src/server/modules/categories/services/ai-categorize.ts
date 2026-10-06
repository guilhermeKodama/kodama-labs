import type { Prisma, PrismaClient } from "@/generated/prisma";
import { categorizeBillTransactions, categorizeStatementTransactions } from "@capital/server/lib/claude";
import { BILL_LABEL_KEYS, STATEMENT_LABEL_KEYS } from "@capital/server/lib/category-prompt";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";
import { getSystemCategory, getSystemCategoryNames } from "../lib/system-categories";

export const AI_CATEGORIZE_CHUNK_SIZE = 50;

/** Imported or statement rows still without a category; manual entries left blank are the user's call. */
const pendingWhere = (userId?: string): Prisma.LedgerEntryWhereInput => ({
  ...(userId && { userId }),
  categoryId: null,
  deletedAt: null,
  transferGroupId: null,
  kind: { in: ["income", "expense"] },
  OR: [{ importId: { not: null } }, { cardStatementId: { not: null } }],
});

export interface AiCategorizers {
  bill?: typeof categorizeBillTransactions;
  statement?: typeof categorizeStatementTransactions;
}

/**
 * Cron step: categorize the next chunk of one user's pending rows with
 * Claude. Card purchases use the bill prompt, bank rows the statement
 * prompt (split by income/expense). The fallback is the system Other
 * category even when it is archived, so every processed row leaves the
 * queue. Each answer other than the fallback also learns an "ai" rule,
 * never overwriting a manual one. `onlyUserId` pins the pick to one user
 * (tests share a database, so the oldest pending row may be someone else's).
 */
export async function categorizePendingEntries(db: PrismaClient, categorizers: AiCategorizers = {}, onlyUserId?: string) {
  const next = await db.ledgerEntry.findFirst({ where: pendingWhere(onlyUserId), orderBy: { createdAt: "asc" }, select: { userId: true } });
  if (!next) return { userId: null, processed: 0, remaining: 0 };
  const userId = next.userId;

  const chunk = await db.ledgerEntry.findMany({
    where: pendingWhere(userId),
    orderBy: { createdAt: "asc" },
    take: AI_CATEGORIZE_CHUNK_SIZE,
    include: { account: { select: { type: true } } },
  });
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, isArchived: true } });
  const otherExpense = await getSystemCategory(userId, "other_system", db);
  const otherIncome = await getSystemCategory(userId, "other_income", db);
  const visible = (type: "income" | "expense", fallback: string) => [...new Set([...categories.filter((c) => c.type === type && !c.isArchived).map((c) => c.name), fallback])];
  const idFor = (name: string, type: "income" | "expense") =>
    categories.find((c) => c.name === name && c.type === type)?.id ?? (type === "income" ? otherIncome.id : otherExpense.id);

  const card = chunk.filter((e) => e.account.type === "credit_card");
  const bankExpense = chunk.filter((e) => e.account.type !== "credit_card" && e.kind === "expense");
  const bankIncome = chunk.filter((e) => e.account.type !== "credit_card" && e.kind === "income");
  const input = (rows: typeof chunk) => rows.map((e, index) => ({ index, description: e.description, merchantName: e.merchantName ?? undefined, amount: Math.abs(Number(e.amount)) }));

  const assignments: { entry: (typeof chunk)[number]; categoryId: string; isFallback: boolean }[] = [];
  const collect = (rows: typeof chunk, results: { index: number; category: string }[], type: "income" | "expense", fallbackId: string) => {
    for (const r of results) {
      const entry = rows[r.index];
      if (!entry) continue;
      const categoryId = idFor(r.category, type);
      assignments.push({ entry, categoryId, isFallback: categoryId === fallbackId });
    }
  };
  if (card.length) {
    const labels = await getSystemCategoryNames(userId, BILL_LABEL_KEYS, db);
    collect(card, await (categorizers.bill ?? categorizeBillTransactions)(input(card), visible("expense", otherExpense.name), otherExpense.name, labels), "expense", otherExpense.id);
  }
  if (bankExpense.length || bankIncome.length) {
    const labels = await getSystemCategoryNames(userId, STATEMENT_LABEL_KEYS, db);
    const categorize = categorizers.statement ?? categorizeStatementTransactions;
    if (bankExpense.length) collect(bankExpense, await categorize(input(bankExpense), visible("expense", otherExpense.name), "expense", otherExpense.name, labels), "expense", otherExpense.id);
    if (bankIncome.length) collect(bankIncome, await categorize(input(bankIncome), visible("income", otherIncome.name), "income", otherIncome.name, labels), "income", otherIncome.id);
  }

  await db.$transaction(assignments.map((a) => db.ledgerEntry.update({ where: { id: a.entry.id }, data: { categoryId: a.categoryId, isAutoCategorized: true } })));

  for (const a of assignments) {
    if (a.isFallback) continue;
    const pattern = normalizeDescription(a.entry.description);
    if (!pattern) continue;
    const existing = await db.categorizationRule.findUnique({ where: { userId_matchType_pattern: { userId, matchType: "equals", pattern } }, select: { source: true } });
    if (existing?.source === "manual") continue;
    await db.categorizationRule.upsert({
      where: { userId_matchType_pattern: { userId, matchType: "equals", pattern } },
      create: { userId, matchType: "equals", pattern, categoryId: a.categoryId, source: "ai" },
      update: { categoryId: a.categoryId, source: "ai" },
    });
  }

  const importIds = [...new Set(chunk.map((e) => e.importId).filter((id): id is string => !!id))];
  for (const importId of importIds) {
    const left = await db.ledgerEntry.count({ where: { ...pendingWhere(userId), importId } });
    await db.import.update({ where: { id: importId }, data: { categorizationStatus: left ? "processing" : "completed" } });
  }

  return { userId, processed: assignments.length, remaining: await db.ledgerEntry.count({ where: pendingWhere(userId) }) };
}
