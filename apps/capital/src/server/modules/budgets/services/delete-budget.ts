import type { DbClient } from "@capital/server/lib/prisma";
import { deleteBudget as deleteBudgetCmd } from "../data/commands/delete-budget";

export async function deleteBudgetService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteBudgetCmd(userId, id, db);
}
