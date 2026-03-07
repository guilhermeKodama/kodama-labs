import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";

interface UpdateBudgetData {
  entityType?: EntityType;
  entityId?: string;
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  year?: number;
  month?: number | null;
  isActive?: boolean;
}

/**
 * Update a budget, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The budget ID
 * @param data - The data to update
 * @throws If budget not found or not owned by user
 */
export async function updateBudget(
  userId: string,
  id: string,
  data: UpdateBudgetData,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const budget = await db.budget.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!budget) {
    throw new Error("Budget not found");
  }

  const { entityType, entityId, ...rest } = data;

  // If entity is being changed, verify ownership of the new entity and build association update
  if (entityType && entityId) {
    if (entityType === "business") {
      const business = await db.business.findFirst({
        where: { id: entityId, userId },
        select: { id: true },
      });
      if (!business) {
        throw new Error("Business not found or access denied");
      }
      return db.budget.update({
        where: { id },
        data: {
          ...rest,
          entityType,
          businessId: entityId,
          personalAccountId: null,
        },
      });
    } else {
      const personalAccount = await db.personalAccount.findFirst({
        where: { id: entityId, userId },
        select: { id: true },
      });
      if (!personalAccount) {
        throw new Error("Personal account not found or access denied");
      }
      return db.budget.update({
        where: { id },
        data: {
          ...rest,
          entityType,
          personalAccountId: entityId,
          businessId: null,
        },
      });
    }
  }

  return db.budget.update({
    where: { id },
    data: rest,
  });
}
