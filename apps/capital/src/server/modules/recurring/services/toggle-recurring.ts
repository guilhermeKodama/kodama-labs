import type { DbClient } from "@capital/server/lib/prisma";
import { updateRecurring } from "../data/commands/update-recurring";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

export async function toggleRecurring(id: string, db: DbClient) {
  const existing = await fetchRecurringById(id, db);
  if (!existing) {
    throw new Error("Recurring transaction not found");
  }

  return updateRecurring(id, { isActive: !existing.isActive }, db);
}
