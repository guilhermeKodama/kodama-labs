import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";
import { insertBudget } from "../data/commands/insert-budget";

interface CreateBudgetInput {
  entityType: EntityType;
  category: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  year: number;
  month?: number;
  businessId?: string;
  personalAccountId?: string;
}

export async function createBudget(input: CreateBudgetInput, db: DbClient) {
  // Validate entity matches type
  if (input.entityType === "business" && !input.businessId) {
    throw new Error("businessId is required for business entity type");
  }
  if (input.entityType === "personal" && !input.personalAccountId) {
    throw new Error(
      "personalAccountId is required for personal entity type"
    );
  }

  // Validate month for monthly budgets
  if (input.period === "monthly" && !input.month) {
    throw new Error("month is required for monthly budgets");
  }

  return insertBudget(input, db);
}
