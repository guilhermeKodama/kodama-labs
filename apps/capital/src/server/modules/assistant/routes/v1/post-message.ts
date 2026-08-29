import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { CONFLICT, BAD_REQUEST } from "stoker/http-status-codes";
import type { Context } from "hono";
import type { AppBindings } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchConversationById } from "../../data/queries/fetch-conversations";
import { fetchRunningTurn } from "../../data/queries/fetch-message-history";
import { runAgentTurn } from "../../agent/loop";
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
    return c.json({ error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);
  }

  const parsed = MessageInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: "BAD_REQUEST", message: parsed.error.message } }, BAD_REQUEST);
  }
  const body = parsed.data;
  if (!body.text && !body.cardResponse && !body.fileIds?.length) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "text, cardResponse or fileIds is required" } },
      BAD_REQUEST
    );
  }

  const running = await fetchRunningTurn(conversationId, prisma);
  if (running) {
    return c.json(
      { error: { code: "CONFLICT", message: "A turn is already running for this conversation" } },
      CONFLICT
    );
  }

  return streamSSE(c, async (stream) => {
    let ended = false;
    const emit = (event: AgentEvent) => {
      if (ended) return;
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };

    stream.onAbort(() => {
      ended = true;
    });

    try {
      await runAgentTurn(
        { userId, conversationId, text: body.text, cardResponse: body.cardResponse, fileIds: body.fileIds },
        emit
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      emit({ type: "error", code: "STREAM_FAILED", message, retryable: true });
    } finally {
      ended = true;
    }
  });
}
