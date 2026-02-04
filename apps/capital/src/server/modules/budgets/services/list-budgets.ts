import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";
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

export async function listBudgets(filters: ListBudgetsInput, db: DbClient) {
  return fetchBudgets(filters, db);
}
