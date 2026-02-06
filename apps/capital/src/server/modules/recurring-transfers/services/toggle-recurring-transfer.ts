import type { DbClient } from "@capital/server/lib/prisma";
import { updateRecurringTransfer } from "../data/commands/update-recurring-transfer";
import { fetchRecurringTransferById } from "../data/queries/fetch-recurring-transfers";

export async function toggleRecurringTransfer(
  userId: string,
  id: string,
  db: DbClient
) {
  const existing = await fetchRecurringTransferById(userId, id, db);
  if (!existing) {
    throw new Error("Recurring transfer not found");
  }

  // Data layer will verify ownership
  return updateRecurringTransfer(userId, id, { isActive: !existing.isActive }, db);
}
