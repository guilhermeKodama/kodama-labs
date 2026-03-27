import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

interface FetchRecurringFilters {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  isActive?: boolean;
}

/**
 * Fetch recurring transactions filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchRecurringTransactions(
  userId: string,
  filters: FetchRecurringFilters,
  db: DbClient
) {
  return db.recurringTransaction.findMany({
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
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: { nextDueDate: "asc" },
  });
}

/**
 * Fetch a single recurring transaction by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transaction ID
 * @returns The recurring transaction if found and owned by user, null otherwise
 */
export async function fetchRecurringById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.recurringTransaction.findFirst({
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

/**
 * Fetch due recurring transactions for the cron job.
 * This is a system-level function that fetches all due recurring transactions.
 * Note: This doesn't filter by userId since it's for system-level processing.
 */
export async function fetchDueRecurring(db: DbClient) {
  return db.recurringTransaction.findMany({
    where: {
      isActive: true,
      nextDueDate: {
        lte: new Date(),
      },
    },
    include: {
      business: true,
      personalAccount: true,
    },
  });
}
