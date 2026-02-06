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

/**
 * Insert a new budget after verifying user ownership of the target entity.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param data - The budget data
 * @throws If the target business/personalAccount is not owned by the user
 */
export async function insertBudget(
  userId: string,
  data: CreateBudgetData,
  db: DbClient
) {
  // MANDATORY: Verify user owns the target entity before creating budget
  if (data.businessId) {
    const business = await db.business.findFirst({
      where: { id: data.businessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Business not found or access denied");
    }
  }

  if (data.personalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: data.personalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Personal account not found or access denied");
    }
  }

  return db.budget.create({
    data,
  });
}
