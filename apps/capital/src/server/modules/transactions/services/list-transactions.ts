import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@prisma/client";
import { fetchTransactions } from "../data/queries/fetch-transactions";

interface ListTransactionsInput {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  type?: TransactionType;
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listTransactions(
  filters: ListTransactionsInput,
  db: DbClient
) {
  return fetchTransactions(filters, db);
}
