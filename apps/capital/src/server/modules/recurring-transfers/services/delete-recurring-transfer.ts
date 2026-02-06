import type { DbClient } from "@capital/server/lib/prisma";
import { deleteRecurringTransfer as deleteRecurringTransferCommand } from "../data/commands/delete-recurring-transfer";

export async function deleteRecurringTransfer(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteRecurringTransferCommand(userId, id, db);
}
