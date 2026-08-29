import type { DbClient } from "@capital/server/lib/prisma";
import { insertConversation } from "../data/commands/insert-conversation";

export async function createConversation(
  userId: string,
  input: { title?: string },
  db: DbClient
) {
  return insertConversation(userId, input, db);
}
