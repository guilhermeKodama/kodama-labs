import type { DbClient } from "@capital/server/lib/prisma";
import { deleteTransfer as deleteTransferCmd } from "../data/commands/delete-transfer";

export async function deleteTransferService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteTransferCmd(userId, id, db);
}
