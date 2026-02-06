import type { DbClient } from "@capital/server/lib/prisma";
import { deleteRecurring as deleteRecurringCmd } from "../data/commands/delete-recurring";

export async function deleteRecurringService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteRecurringCmd(userId, id, db);
}
