import type { DbClient } from "@capital/server/lib/prisma";
import { ForbiddenError } from "@capital/server/lib/auth-middleware";

async function verifyConversationOwnership(
  userId: string,
  conversationId: string,
  db: DbClient
) {
  const conversation = await db.agentConversation.findFirst({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (conversation.userId !== userId) {
    throw new ForbiddenError("conversation");
  }
}

/**
 * Rename a conversation.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function updateConversationTitle(
  userId: string,
  conversationId: string,
  title: string,
  db: DbClient
) {
  await verifyConversationOwnership(userId, conversationId, db);
  return db.agentConversation.update({
    where: { id: conversationId },
    data: { title },
  });
}

/**
 * Soft-delete (archive) a conversation.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function archiveConversationRow(
  userId: string,
  conversationId: string,
  db: DbClient
) {
  await verifyConversationOwnership(userId, conversationId, db);
  return db.agentConversation.update({
    where: { id: conversationId },
    data: { status: "archived" },
  });
}

/**
 * Bump lastMessageAt so the conversation sorts to the top of the list.
 * Ownership is assumed pre-verified by the caller (called from inside the
 * message-send / agent-turn path, not exposed as its own endpoint).
 */
export async function touchConversation(conversationId: string, db: DbClient) {
  return db.agentConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
}
