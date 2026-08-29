import type { DbClient } from "@capital/server/lib/prisma";

export async function insertAgentMessage(
  input: { conversationId: string; turnId?: string; role: "user" | "assistant"; content: unknown; kind: string },
  db: DbClient
) {
  return db.agentMessage.create({
    data: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      role: input.role,
      content: input.content as object,
      kind: input.kind,
    },
  });
}

/**
 * The assistant message row is created empty at the START of an
 * iteration (so its id can stream token events) and filled in here once
 * the model's response is complete - this is the per-iteration
 * persistence that lets a killed function lose nothing durable.
 */
export async function updateAgentMessageContent(messageId: string, content: unknown, db: DbClient) {
  return db.agentMessage.update({ where: { id: messageId }, data: { content: content as object } });
}
