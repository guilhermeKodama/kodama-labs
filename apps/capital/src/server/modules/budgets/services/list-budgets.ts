import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@/generated/prisma";
import { fetchBudgets } from "../data/queries/fetch-budgets";

interface ListBudgetsInput {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  year?: number;
  month?: number;
  period?: BudgetPeriod;
  isActive?: boolean;
}

export async function listBudgets(
  userId: string,
  filters: ListBudgetsInput,
  db: DbClient
) {
  return fetchBudgets(userId, filters, db);
}
