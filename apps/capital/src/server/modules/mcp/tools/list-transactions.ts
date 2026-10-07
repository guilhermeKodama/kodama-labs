import type { Prisma } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import type { ListTransactionsParams, TransactionSummary } from "../lib/types";
import { parseDateRangeFilter } from "../lib/date-helpers";
import { toNumber } from "../../ledger/lib/money";
import { LEGACY_ENTRY_INCLUDE, legacyType, toLegacyTransaction } from "../lib/ledger-adapter";

/**
 * Transactions (income, expenses including card purchases, investments;
 * not transfers or card bill payments) with per type/category totals in the
 * base currency. Dates filter on the effective date, so card purchases fall
 * in the month their statement closes. A refund is an expense with a
 * negative amount; the category total nets it, the same way the budget does.
 */
export async function listTransactions(userId: string, params: ListTransactionsParams, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  if (!user) throw new Error("User not found");

  const range = parseDateRangeFilter(params.dateFrom, params.dateTo);
  const entityId = params.businessId ?? params.personalAccountId;
  const where: Prisma.LedgerEntryWhereInput = {
    userId,
    deletedAt: null,
    transferGroupId: null,
    kind: params.type ? params.type : { in: ["income", "expense", "investment"] },
    ...(entityId && { entityId }),
    ...(params.entityType && { entity: { kind: params.entityType } }),
    ...(params.category && { category: { name: params.category } }),
    ...((range.dateFrom || range.dateTo) && { effectiveDate: { ...(range.dateFrom && { gte: range.dateFrom }), ...(range.dateTo && { lte: range.dateTo }) } }),
  };
  const entries = await db.ledgerEntry.findMany({ where, include: LEGACY_ENTRY_INCLUDE, orderBy: { date: "desc" } });

  const summaryMap = new Map<string, TransactionSummary>();
  for (const e of entries) {
    const type = legacyType(e);
    const category = e.category?.name ?? "";
    const key = `${type}|${category}`;
    const inBase = type === "income" ? toNumber(e.amountBase) : -toNumber(e.amountBase);
    const s = summaryMap.get(key);
    if (s) {
      s.total += inBase;
      s.count += 1;
    } else summaryMap.set(key, { type, category, total: inBase, count: 1, currency: user.baseCurrency });
  }

  return {
    transactions: entries.map((e) => {
      const t = toLegacyTransaction(e);
      return {
        id: t.id,
        entityType: t.entityType,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        exchangeRate: t.exchangeRate,
        description: t.description,
        category: t.category,
        date: t.date,
        isTaxDeductible: t.isTaxDeductible,
        businessId: t.businessId,
        personalAccountId: t.personalAccountId,
        createdAt: t.createdAt,
      };
    }),
    summaries: [...summaryMap.values()],
  };
}
