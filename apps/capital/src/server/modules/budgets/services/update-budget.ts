import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, BudgetPeriod } from "@prisma/client";
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
  return updateBudgetCmd(userId, id, input, db);
}
