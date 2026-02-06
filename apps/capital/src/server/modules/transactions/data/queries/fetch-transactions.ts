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

/**
 * Fetch transactions filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchTransactions(
  userId: string,
  filters: FetchTransactionsFilters,
  db: DbClient
) {
  return db.transaction.findMany({
    where: {
      // MANDATORY: Always filter by user ownership through business or personalAccount
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
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

/**
 * Fetch a single transaction by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transaction ID
 * @returns The transaction if found and owned by user, null otherwise
 */
export async function fetchTransactionById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.transaction.findFirst({
    where: {
      id,
      // MANDATORY: Verify ownership through business or personalAccount
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
  });
}
