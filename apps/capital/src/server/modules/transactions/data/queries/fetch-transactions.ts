import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@prisma/client";

interface FetchTransactionsFilters {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  type?: TransactionType;
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function fetchTransactions(
  filters: FetchTransactionsFilters,
  db: DbClient
) {
  return db.transaction.findMany({
    where: {
      ...(filters.businessId && { businessId: filters.businessId }),
      ...(filters.personalAccountId && {
        personalAccountId: filters.personalAccountId,
      }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.type && { type: filters.type }),
      ...(filters.category && { category: filters.category }),
      ...(filters.dateFrom || filters.dateTo
        ? {
            date: {
              ...(filters.dateFrom && { gte: filters.dateFrom }),
              ...(filters.dateTo && { lte: filters.dateTo }),
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
  });
}

export async function fetchTransactionById(id: string, db: DbClient) {
  return db.transaction.findUnique({
    where: { id },
  });
}
