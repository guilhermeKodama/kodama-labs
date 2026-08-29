import type { DbClient } from "@capital/server/lib/prisma";
import { fetchConversationDetail } from "../data/queries/fetch-conversations";

export async function getConversation(userId: string, id: string, db: DbClient) {
  const conversation = await fetchConversationDetail(userId, id, db);
  if (!conversation) {
    throw new Error("Conversation not found or access denied");
  }
  return conversation;
}
