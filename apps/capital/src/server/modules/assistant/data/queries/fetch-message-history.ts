import type { DbClient } from "@capital/server/lib/prisma";

export async function fetchMessageHistory(conversationId: string, db: DbClient) {
  return db.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
}

/** Used to reject a new message while a turn is still in flight. */
export async function fetchRunningTurn(conversationId: string, db: DbClient) {
  return db.agentTurn.findFirst({
    where: { conversationId, status: "running" },
    select: { id: true },
  });
}
