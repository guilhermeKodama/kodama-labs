import type { DbClient } from "@capital/server/lib/prisma";

interface FetchTransfersFilters {
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function fetchTransfers(
  filters: FetchTransfersFilters,
  db: DbClient
) {
  return db.transfer.findMany({
    where: {
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

export async function fetchTransferById(id: string, db: DbClient) {
  return db.transfer.findUnique({
    where: { id },
  });
}
