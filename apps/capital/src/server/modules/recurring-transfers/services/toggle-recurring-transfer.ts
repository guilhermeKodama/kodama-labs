import type { DbClient } from "@capital/server/lib/prisma";
import { updateRecurringTransfer } from "../data/commands/update-recurring-transfer";
import { fetchRecurringTransferById } from "../data/queries/fetch-recurring-transfers";

export async function toggleRecurringTransfer(id: string, db: DbClient) {
  const existing = await fetchRecurringTransferById(id, db);
  if (!existing) {
    throw new Error("Recurring transfer not found");
  }

  return updateRecurringTransfer(id, { isActive: !existing.isActive }, db);
}
