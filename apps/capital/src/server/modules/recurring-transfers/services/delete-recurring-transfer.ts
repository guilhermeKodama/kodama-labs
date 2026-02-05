import type { DbClient } from "@capital/server/lib/prisma";
import { deleteRecurringTransfer as deleteRecurringTransferCommand } from "../data/commands/delete-recurring-transfer";

export async function deleteRecurringTransfer(id: string, db: DbClient) {
  return deleteRecurringTransferCommand(id, db);
}
