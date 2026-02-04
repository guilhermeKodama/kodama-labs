import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";

interface CreateBudgetData {
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

export async function insertBudget(data: CreateBudgetData, db: DbClient) {
  return db.budget.create({
    data,
  });
}
