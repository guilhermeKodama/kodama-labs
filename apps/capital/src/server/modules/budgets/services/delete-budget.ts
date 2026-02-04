import type { DbClient } from "@capital/server/lib/prisma";
import { deleteBudget as deleteBudgetCmd } from "../data/commands/delete-budget";
import { fetchBudgetById } from "../data/queries/fetch-budgets";

export async function deleteBudgetService(id: string, db: DbClient) {
  const existing = await fetchBudgetById(id, db);
  if (!existing) {
    throw new Error("Budget not found");
  }

  return deleteBudgetCmd(id, db);
}
