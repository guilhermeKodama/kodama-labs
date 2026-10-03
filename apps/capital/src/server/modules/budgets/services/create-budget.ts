import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@/generated/prisma";
import { insertBudget } from "../data/commands/insert-budget";

interface CreateBudgetInput {
  entityType: EntityType;
  category: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  year: number;
  month?: number;
  effectiveFrom?: Date; // Optional for backward compatibility
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

  // Calculate effectiveFrom if not provided (backward compatibility)
  const effectiveFrom = input.effectiveFrom || new Date(
    Date.UTC(input.year, (input.month || 1) - 1, 1, 12, 0, 0, 0)
  );

  // Check for existing budget with the same entity+category+effectiveFrom
  const existing = await db.budget.findFirst({
    where: {
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
      ...(input.businessId && { businessId: input.businessId }),
      ...(input.personalAccountId && { personalAccountId: input.personalAccountId }),
      category: input.category,
      effectiveFrom,
    },
  });

  if (existing) {
    throw new Error(
      `A budget for "${input.category}" already exists for this effective date. Please edit the existing budget instead.`
    );
  }

  // Data layer will verify ownership
  return insertBudget(
    userId,
    {
      ...input,
      effectiveFrom,
    },
    db
  );
}
