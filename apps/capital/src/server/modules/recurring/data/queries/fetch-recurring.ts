import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";

interface FetchRecurringFilters {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  isActive?: boolean;
}

export async function fetchRecurringTransactions(
  filters: FetchRecurringFilters,
  db: DbClient
) {
  return db.recurringTransaction.findMany({
    where: {
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

export async function fetchRecurringById(id: string, db: DbClient) {
  return db.recurringTransaction.findUnique({
    where: { id },
  });
}

export async function fetchDueRecurring(db: DbClient) {
  return db.recurringTransaction.findMany({
    where: {
      isActive: true,
      nextDueDate: {
        lte: new Date(),
      },
    },
  });
}
