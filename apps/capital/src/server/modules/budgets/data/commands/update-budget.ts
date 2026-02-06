import type { DbClient } from "@capital/server/lib/prisma";
import type { BudgetPeriod } from "@prisma/client";

interface UpdateBudgetData {
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  year?: number;
  month?: number;
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

  return db.budget.update({
    where: { id },
    data,
  });
}
