import type { DbClient } from "@capital/server/lib/prisma";
import { deleteSubscription } from "../data/commands/delete-subscription";

export async function unsubscribeFromPush(
  userId: string,
  endpoint: string,
  db: DbClient
) {
  return deleteSubscription(userId, endpoint, db);
}
