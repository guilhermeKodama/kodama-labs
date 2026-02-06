import type { DbClient } from "@capital/server/lib/prisma";
import { updateRecurring } from "../data/commands/update-recurring";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

export async function toggleRecurring(
  userId: string,
  id: string,
  db: DbClient
) {
  const existing = await fetchRecurringById(userId, id, db);
  if (!existing) {
    throw new Error("Recurring transaction not found");
  }

  // Data layer will verify ownership
  return updateRecurring(userId, id, { isActive: !existing.isActive }, db);
}
