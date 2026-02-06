import type { DbClient } from "@capital/server/lib/prisma";
import type { BudgetPeriod } from "@prisma/client";
import { updateBudget as updateBudgetCmd } from "../data/commands/update-budget";

interface UpdateBudgetInput {
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  year?: number;
  month?: number;
  isActive?: boolean;
}

export async function updateBudgetService(
  userId: string,
  id: string,
  input: UpdateBudgetInput,
  db: DbClient
) {
  // Data layer will verify ownership
  return updateBudgetCmd(userId, id, input, db);
}
