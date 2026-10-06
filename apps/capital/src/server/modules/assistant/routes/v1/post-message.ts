import { z } from "zod";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import type { AppBindings } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { validationError } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { fetchConversationById } from "../../data/queries/fetch-conversations";
import { fetchRunningTurn } from "../../data/queries/fetch-message-history";
import { runAgentTurn, type RunAgentTurnInput } from "../../agent/loop";
import type { AgentEvent } from "../../agent/events";

const MessageInputSchema = z.object({
  text: z.string().min(1).optional(),
  cardResponse: z
    .object({
      cardId: z.string(),
      decisions: z.array(z.object({ pairId: z.string(), label: z.string() })),
    })
    .optional(),
  fileIds: z.array(z.string()).optional(),
  clientMessageId: z.string().optional(),
});

/**
 * Not wired through createRoute/OpenAPI: SSE is a poor fit for a
 * JSON-schema response, and the actual protocol is documented in
 * agent/events.ts (AgentEvent). Registered as a plain route on the same
 * OpenAPIHono router in routes/v1/index.ts - the /v1/assistant/*
 * authMiddleware prefix still applies regardless of how the route is
 * mounted.
 */
export async function postMessageHandler(c: Context<AppBindings>) {
  const userId = requireUserId(c);
  const conversationId = c.req.param("id");

  const conversation = await fetchConversationById(userId, conversationId, prisma);
  if (!conversation) {
    throw new LedgerError("Conversation not found", 404, { code: "assistant.conversation_not_found" });
  }

  const parsed = MessageInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  const body = parsed.data;
  if (!body.text && !body.cardResponse && !body.fileIds?.length) {
    throw new LedgerError("text, cardResponse or fileIds is required", 400, { code: "assistant.message_required" });
  }

  const running = await fetchRunningTurn(conversationId, prisma);
  if (running) {
    throw new LedgerError("A turn is already running for this conversation", 409, { code: "assistant.turn_running" });
  }

  return streamTurn(c, { userId, conversationId, text: body.text, cardResponse: body.cardResponse, fileIds: body.fileIds });
}

/** Runs a turn and writes its events to the response as SSE frames (shared by …/messages and …/retry). */
export function streamTurn(c: Context<AppBindings>, input: RunAgentTurnInput) {
  return streamSSE(c, async (stream) => {
    let ended = false;
    // writeSSE is async: chained so frames keep their order, and awaited
    // before the callback returns, because Hono closes the stream then and
    // a frame still in flight (turn_completed, the last one) would be lost.
    let writes: Promise<unknown> = Promise.resolve();
    const emit = (event: AgentEvent) => {
      if (ended) return;
      writes = writes.then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) })).catch(() => undefined);
    };

    stream.onAbort(() => {
      ended = true;
    });

    try {
      await runAgentTurn(input, emit);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      emit({ type: "error", code: "STREAM_FAILED", message, retryable: true });
    } finally {
      await writes;
      ended = true;
    }
  });
}
