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

export async function createBudget(
  userId: string,
  input: CreateBudgetInput,
  db: DbClient
) {
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

  // Check for existing budget with the same entity+category+period+year+month
  const existing = await db.budget.findFirst({
    where: {
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
      ...(input.businessId && { businessId: input.businessId }),
      ...(input.personalAccountId && { personalAccountId: input.personalAccountId }),
      category: input.category,
      period: input.period,
      year: input.year,
      ...(input.month !== undefined && { month: input.month }),
    },
  });

  if (existing) {
    throw new Error(
      `A budget for "${input.category}" already exists for this period. Please edit the existing budget instead.`
    );
  }

  // Data layer will verify ownership
  return insertBudget(userId, input, db);
}
