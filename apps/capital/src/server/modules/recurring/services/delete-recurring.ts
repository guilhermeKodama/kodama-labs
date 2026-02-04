import type { DbClient } from "@capital/server/lib/prisma";
import { deleteRecurring as deleteRecurringCmd } from "../data/commands/delete-recurring";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

export async function deleteRecurringService(id: string, db: DbClient) {
  const existing = await fetchRecurringById(id, db);
  if (!existing) {
    throw new Error("Recurring transaction not found");
  }

  return deleteRecurringCmd(id, db);
}
