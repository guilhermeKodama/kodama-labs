import type { DbClient } from "@capital/server/lib/prisma";

interface FetchTransfersFilters {
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Fetch transfers filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchTransfers(
  userId: string,
  filters: FetchTransfersFilters,
  db: DbClient
) {
  return db.transfer.findMany({
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
 * Fetch a single transfer by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transfer ID
 * @returns The transfer if found and owned by user, null otherwise
 */
export async function fetchTransferById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.transfer.findFirst({
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
