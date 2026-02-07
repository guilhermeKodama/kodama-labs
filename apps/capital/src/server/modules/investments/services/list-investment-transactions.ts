import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@prisma/client";
import { fetchInvestmentTransactions } from "../data/queries/fetch-investment-transactions";

interface ListInvestmentTransactionsInput {
  holdingId?: string;
  accountId?: string;
  type?: InvestmentTransactionType;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listInvestmentTransactions(
  userId: string,
  filters: ListInvestmentTransactionsInput,
  db: DbClient
) {
  return fetchInvestmentTransactions(userId, filters, db);
}
