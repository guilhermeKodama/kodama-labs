/**
 * The complete SSE protocol between an agent turn and the browser. The
 * route (routes/v1/post-message.ts) writes these as
 * `event: <type>\ndata: <json>\n\n` frames; the loop only ever calls the
 * `emit` callback, it knows nothing about HTTP.
 */
export type AgentEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "message_created"; message: { id: string; role: string; kind: string; createdAt: string } }
  | { type: "token"; messageId: string; delta: string }
  | { type: "tool_call_started"; messageId: string; toolCallId: string; tool: string; label: string }
  | {
      type: "tool_call_result";
      messageId: string;
      toolCallId: string;
      tool: string;
      status: "success" | "error";
      summary?: string;
    }
  | { type: "action_card"; messageId: string; card: unknown }
  | {
      type: "plan_proposed";
      messageId: string;
      planId: string;
      kind: "import" | "revert";
      summary: unknown;
      payloadHash: string;
      warnings: string[];
    }
  | { type: "card_locked"; cardId: string; decision: unknown }
  | { type: "plan_committed"; messageId: string; planId: string; kind: "import" | "revert"; result: unknown }
  | { type: "message_complete"; messageId: string }
  | {
      type: "turn_completed";
      turnId: string;
      status: "completed" | "failed" | "cancelled";
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export type EmitFn = (event: AgentEvent) => void;
