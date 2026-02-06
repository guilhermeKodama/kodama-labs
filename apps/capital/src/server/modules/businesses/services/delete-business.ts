import type { DbClient } from "@capital/server/lib/prisma";
import { deleteBusiness as deleteBusinessCmd } from "../data/commands/delete-business";

export async function deleteBusinessService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Data layer will verify ownership
  return deleteBusinessCmd(userId, id, db);
}
