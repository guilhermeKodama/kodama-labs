import type { DbClient } from "@capital/server/lib/prisma";
import { archiveConversationRow } from "../data/commands/update-conversation";

export async function archiveConversation(userId: string, id: string, db: DbClient) {
  return archiveConversationRow(userId, id, db);
}
