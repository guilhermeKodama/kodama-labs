import type { DbClient } from "@capital/server/lib/prisma";
import type { AgentTurnStatus } from "@/generated/prisma";

export async function insertAgentTurn(
  conversationId: string,
  model: string,
  db: DbClient
) {
  return db.agentTurn.create({
    data: { conversationId, model, status: "running" },
  });
}

export async function updateAgentTurn(
  turnId: string,
  data: {
    status?: AgentTurnStatus;
    iterations?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    costUsd?: number;
    durationMs?: number;
    error?: string;
    completedAt?: Date;
  },
  db: DbClient
) {
  return db.agentTurn.update({ where: { id: turnId }, data });
}

/** Cheap poll target for the loop's between-iteration cancellation check. */
export async function fetchAgentTurnStatus(turnId: string, db: DbClient) {
  const turn = await db.agentTurn.findUnique({ where: { id: turnId }, select: { status: true } });
  return turn?.status ?? null;
}
