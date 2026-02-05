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

export async function fetchRecurringTransfers(
  filters: FetchRecurringTransfersFilters,
  db: DbClient
) {
  return db.recurringTransfer.findMany({
    where: {
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

export async function fetchRecurringTransferById(id: string, db: DbClient) {
  return db.recurringTransfer.findUnique({
    where: { id },
  });
}
