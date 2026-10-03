import type { Prisma } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import type { ListTransactionsParams, TransactionSummary } from "../lib/types";
import { fetchTransactions } from "../../transactions/data/queries/fetch-transactions";
import { parseDateRangeFilter } from "../lib/date-helpers";
import { shouldCountAsExpense, buildSettlementSet } from "../../../../lib/utils/expense-classification";
import { amountInUserBase } from "@/lib/utils/currency";
import type { Currency } from "@/types";
import { statementInWindow } from "../../credit-cards/lib/statement-window";

/**
 * List transactions with optional filters and monthly summaries.
 * When filtering by expense type, excludes credit card settlement payments from summaries
 * but includes statement purchases.
 */
export async function listTransactions(
  userId: string,
  params: ListTransactionsParams,
  db: DbClient
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { baseCurrency: true },
  });
  if (!user) {
    throw new Error("User not found");
  }
  const currencyRows = await db.currency.findMany({ where: { userId } });
  const currencies: Currency[] = currencyRows.map((row) => ({
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    manualRate: row.manualRate,
    updatedAt: row.updatedAt,
  }));

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

  // Fetch settlement IDs
  const statements = await db.creditCardStatement.findMany({
    where: {
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    select: {
      billPaymentTransactionId: true,
    },
  });

  const settlementIds = buildSettlementSet(statements);

  // Fetch statement purchases if filtering for expenses
  let statementPurchases: Array<{
    id: string;
    category: string;
    amount: number;
    currency: string;
    transactionDate: Date;
  }> = [];

  if (!params.type || params.type === 'expense') {
    const billTxFilters: Prisma.BillTransactionWhereInput = {
      statementId: { not: null },
      ...(params.category ? { category: params.category } : {}),
      statement: {
        creditCard: {
          OR: [
            ...(params.businessId ? [{ businessId: params.businessId }] : []),
            ...(params.personalAccountId ? [{ personalAccountId: params.personalAccountId }] : []),
            ...(!params.businessId && !params.personalAccountId && !params.entityType
              ? [{ business: { userId } }, { personalAccount: { userId } }]
              : []),
            ...(params.entityType === 'business' && !params.businessId
              ? [{ business: { userId } }]
              : []),
            ...(params.entityType === 'personal' && !params.personalAccountId
              ? [{ personalAccount: { userId } }]
              : []),
          ],
        },
        ...(dateFilters.dateFrom || dateFilters.dateTo
          ? statementInWindow(dateFilters.dateFrom, dateFilters.dateTo)
          : {}),
      },
    };

    statementPurchases = await db.billTransaction.findMany({
      where: billTxFilters,
      select: {
        id: true,
        category: true,
        amount: true,
        currency: true,
        transactionDate: true,
      },
    });
  }

  // Calculate monthly totals grouped by type and category
  const summaryMap = new Map<string, TransactionSummary>();

  // Add regular transactions (excluding settlements)
  for (const txn of transactions) {
    if (txn.type === 'expense' && !shouldCountAsExpense(txn, settlementIds.has(txn.id))) {
      continue; // Skip card settlements
    }

    const key = `${txn.type}|${txn.category}`;
    const existing = summaryMap.get(key);
    const inBase = amountInUserBase({
      amount: txn.amount,
      currency: txn.currency,
      exchangeRate: txn.exchangeRate,
      currencies,
      baseCurrency: user.baseCurrency,
    });

    if (existing) {
      existing.total += inBase;
      existing.count += 1;
    } else {
      summaryMap.set(key, {
        type: txn.type,
        category: txn.category,
        total: inBase,
        count: 1,
        currency: user.baseCurrency,
      });
    }
  }

  // Add statement purchases to summaries
  for (const purchase of statementPurchases) {
    const key = `expense|${purchase.category}`;
    const existing = summaryMap.get(key);
    const inBase = amountInUserBase({
      amount: purchase.amount,
      currency: purchase.currency,
      currencies,
      baseCurrency: user.baseCurrency,
    });

    if (existing) {
      existing.total += inBase;
      existing.count += 1;
    } else {
      summaryMap.set(key, {
        type: 'expense',
        category: purchase.category,
        total: inBase,
        count: 1,
        currency: user.baseCurrency,
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
