import type { DbClient } from "@capital/server/lib/prisma";

export interface CreatedRecordRef {
  model: string;
  id: string;
}

interface InsertAgentActionInput {
  userId: string;
  conversationId: string;
  turnId?: string;
  planId?: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "success" | "error";
  error?: string;
  createdRecords?: CreatedRecordRef[];
  durationMs: number;
}

/**
 * Audit row for every write-tool execution. This is what makes undo
 * possible (createdRecords) and what a security review of "what did the
 * agent actually do" reads from - never skip it for a write tool.
 */
export async function insertAgentAction(input: InsertAgentActionInput, db: DbClient) {
  return db.agentAction.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      planId: input.planId,
      toolName: input.toolName,
      input: input.input as object,
      output: input.output as object | undefined,
      status: input.status,
      error: input.error,
      createdRecords: input.createdRecords as object | undefined,
      durationMs: input.durationMs,
    },
  });
}
