import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";

interface FetchBudgetsFilters {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  year?: number;
  month?: number;
  period?: BudgetPeriod;
  isActive?: boolean;
}

export async function fetchBudgets(filters: FetchBudgetsFilters, db: DbClient) {
  return db.budget.findMany({
    where: {
      ...(filters.businessId && { businessId: filters.businessId }),
      ...(filters.personalAccountId && {
        personalAccountId: filters.personalAccountId,
      }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.year && { year: filters.year }),
      ...(filters.month && { month: filters.month }),
      ...(filters.period && { period: filters.period }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export async function fetchBudgetById(id: string, db: DbClient) {
  return db.budget.findUnique({
    where: { id },
  });
}
