import type { DbClient } from "@capital/server/lib/prisma";
import type { ListTransactionsParams, TransactionSummary } from "../lib/types";
import { fetchTransactions } from "../../transactions/data/queries/fetch-transactions";

/**
 * List transactions with optional filters and monthly summaries.
 */
export async function listTransactions(
  userId: string,
  params: ListTransactionsParams,
  db: DbClient
) {
  const filters = {
    ...(params.businessId && { businessId: params.businessId }),
    ...(params.personalAccountId && { personalAccountId: params.personalAccountId }),
    ...(params.entityType && { entityType: params.entityType }),
    ...(params.type && { type: params.type }),
    ...(params.category && { category: params.category }),
    ...(params.dateFrom && { dateFrom: new Date(params.dateFrom) }),
    ...(params.dateTo && { dateTo: new Date(params.dateTo) }),
  };

  const transactions = await fetchTransactions(userId, filters, db);

  // Calculate monthly totals grouped by type and category
  const summaryMap = new Map<string, TransactionSummary>();

  for (const txn of transactions) {
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
