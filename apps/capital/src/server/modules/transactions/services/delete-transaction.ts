import type { DbClient } from "@capital/server/lib/prisma";
import { deleteTransaction as deleteTransactionCmd } from "../data/commands/delete-transaction";

export async function deleteTransactionService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteTransactionCmd(userId, id, db);
}
