import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";

interface FetchRecurringTransfersFilters {
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  fromEntityType?: EntityType;
  toEntityType?: EntityType;
  isActive?: boolean;
}

/**
 * Fetch recurring transfers filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchRecurringTransfers(
  userId: string,
  filters: FetchRecurringTransfersFilters,
  db: DbClient
) {
  return db.recurringTransfer.findMany({
    where: {
      // MANDATORY: Always filter by user ownership through business or personalAccount
      OR: [
        { fromBusiness: { userId } },
        { fromPersonalAccount: { userId } },
        { toBusiness: { userId } },
        { toPersonalAccount: { userId } },
      ],
      ...(filters.fromBusinessId && { fromBusinessId: filters.fromBusinessId }),
      ...(filters.fromPersonalAccountId && {
        fromPersonalAccountId: filters.fromPersonalAccountId,
      }),
      ...(filters.toBusinessId && { toBusinessId: filters.toBusinessId }),
      ...(filters.toPersonalAccountId && {
        toPersonalAccountId: filters.toPersonalAccountId,
      }),
      ...(filters.fromEntityType && { fromEntityType: filters.fromEntityType }),
      ...(filters.toEntityType && { toEntityType: filters.toEntityType }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: { nextDueDate: "asc" },
  });
}

/**
 * Fetch a single recurring transfer by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transfer ID
 * @returns The recurring transfer if found and owned by user, null otherwise
 */
export async function fetchRecurringTransferById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.recurringTransfer.findFirst({
    where: {
      id,
      // MANDATORY: Verify ownership through business or personalAccount
      OR: [
        { fromBusiness: { userId } },
        { fromPersonalAccount: { userId } },
        { toBusiness: { userId } },
        { toPersonalAccount: { userId } },
      ],
    },
  });
}

/**
 * Fetch due recurring transfers for the cron job.
 * This is a system-level function.
 */
export async function fetchDueRecurringTransfers(db: DbClient) {
  return db.recurringTransfer.findMany({
    where: {
      isActive: true,
      nextDueDate: {
        lte: new Date(),
      },
    },
    include: {
      fromBusiness: true,
      fromPersonalAccount: true,
      toBusiness: true,
      toPersonalAccount: true,
    },
  });
}
