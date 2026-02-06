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

/**
 * Fetch budgets filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchBudgets(
  userId: string,
  filters: FetchBudgetsFilters,
  db: DbClient
) {
  return db.budget.findMany({
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
      ...(filters.year && { year: filters.year }),
      ...(filters.month && { month: filters.month }),
      ...(filters.period && { period: filters.period }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

/**
 * Fetch a single budget by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The budget ID
 * @returns The budget if found and owned by user, null otherwise
 */
export async function fetchBudgetById(userId: string, id: string, db: DbClient) {
  return db.budget.findFirst({
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
