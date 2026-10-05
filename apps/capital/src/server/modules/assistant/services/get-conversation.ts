import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { fetchConversationDetail } from "../data/queries/fetch-conversations";

export async function getConversation(userId: string, id: string, db: DbClient) {
  const conversation = await fetchConversationDetail(userId, id, db);
  if (!conversation) {
    throw new LedgerError("Conversation not found or access denied", 404, { code: "assistant.conversation_not_found" });
  }
  return conversation;
}
