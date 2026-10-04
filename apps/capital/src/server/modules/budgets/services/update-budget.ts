import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@/generated/prisma";
import { rejectArchivedAssignment } from "@capital/server/modules/mcp/lib/category-validation";
import { updateBudget as updateBudgetCmd } from "../data/commands/update-budget";

interface UpdateBudgetInput {
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

export async function updateBudgetService(
  userId: string,
  id: string,
  input: UpdateBudgetInput,
  db: DbClient
) {
  if (input.category !== undefined) {
    const existing = await db.budget.findFirst({
      where: {
        id,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { category: true },
    });
    if (!existing) {
      throw new Error("Budget not found");
    }
    await rejectArchivedAssignment(
      userId,
      input.category,
      "expense",
      db,
      existing.category
    );
  }

  return updateBudgetCmd(userId, id, input, db);
}
