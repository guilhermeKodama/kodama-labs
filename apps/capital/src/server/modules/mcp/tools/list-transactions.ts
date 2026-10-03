import type { DbClient } from "@capital/server/lib/prisma";
import type { ListTransactionsParams, TransactionSummary } from "../lib/types";
import { fetchTransactions } from "../../transactions/data/queries/fetch-transactions";
import { parseDateRangeFilter } from "../lib/date-helpers";
import { shouldCountAsExpense } from "../../../../lib/utils/expense-classification";

/**
 * List transactions with optional filters and monthly summaries.
 * When filtering by expense type, excludes credit card bill payments from summaries.
 */
export async function listTransactions(
  userId: string,
  params: ListTransactionsParams,
  db: DbClient
) {
  const dateFilters = parseDateRangeFilter(params.dateFrom, params.dateTo);
  
  const filters = {
    ...(params.businessId && { businessId: params.businessId }),
    ...(params.personalAccountId && { personalAccountId: params.personalAccountId }),
    ...(params.entityType && { entityType: params.entityType }),
    ...(params.type && { type: params.type }),
    ...(params.category && { category: params.category }),
    ...dateFilters,
  };

  const transactions = await fetchTransactions(userId, filters, db);

  // Calculate monthly totals grouped by type and category
  // For expense type, only include transactions that count as expenses
  const summaryMap = new Map<string, TransactionSummary>();

  for (const txn of transactions) {
    // Skip expenses that shouldn't count (like credit card bill payments)
    if (txn.type === 'expense' && !shouldCountAsExpense(txn)) {
      continue;
    }

    const key = `${txn.type}|${txn.category}`;
    const existing = summaryMap.get(key);

    if (existing) {
      existing.total += txn.amount;
      existing.count += 1;
    } else {
      summaryMap.set(key, {
        type: txn.type,
        category: txn.category,
        total: txn.amount,
        count: 1,
        currency: txn.currency,
      });
    }
  }

  const summaries = Array.from(summaryMap.values());

  return {
    transactions: transactions.map((txn) => ({
      id: txn.id,
      entityType: txn.entityType,
      type: txn.type,
      amount: txn.amount,
      currency: txn.currency,
      exchangeRate: txn.exchangeRate,
      description: txn.description,
      category: txn.category,
      date: txn.date.toISOString(),
      isTaxDeductible: txn.isTaxDeductible,
      businessId: txn.businessId,
      personalAccountId: txn.personalAccountId,
      createdAt: txn.createdAt.toISOString(),
    })),
    summaries,
  };
}
