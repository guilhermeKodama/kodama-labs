import type { DbClient } from "@capital/server/lib/prisma";
import { deleteCreditCard as deleteCreditCardCmd } from "../data/commands/delete-credit-card";

export async function deleteCreditCardService(
  userId: string,
  id: string,
  db: DbClient
) {
  return deleteCreditCardCmd(userId, id, db);
}
