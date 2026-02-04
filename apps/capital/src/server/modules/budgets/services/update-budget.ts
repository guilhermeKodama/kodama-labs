import type { DbClient } from "@capital/server/lib/prisma";
import type { BudgetPeriod } from "@prisma/client";
import { updateBudget as updateBudgetCmd } from "../data/commands/update-budget";
import { fetchBudgetById } from "../data/queries/fetch-budgets";

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
  id: string,
  input: UpdateBudgetInput,
  db: DbClient
) {
  const existing = await fetchBudgetById(id, db);
  if (!existing) {
    throw new Error("Budget not found");
  }

  return updateBudgetCmd(id, input, db);
}
