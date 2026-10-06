import type { Context } from "hono";
import type { AppBindings } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { fetchConversationById } from "../../data/queries/fetch-conversations";
import { fetchRunningTurn } from "../../data/queries/fetch-message-history";
import { canRetryLastTurn } from "../../services/retry-turn";
import { streamTurn } from "./post-message";

/**
 * POST /v1/assistant/conversations/:id/retry - "Tentar de novo" after a
 * turn failed on the server. Runs a new turn against the user message the
 * failed one already saved, without saving it again, and streams it like
 * POST …/messages (SSE, agent/events.ts). 409 assistant.nothing_to_retry
 * when the last turn did not fail or its message was answered since.
 */
export async function postRetryHandler(c: Context<AppBindings>) {
  const userId = requireUserId(c);
  const conversationId = c.req.param("id");

  const conversation = await fetchConversationById(userId, conversationId, prisma);
  if (!conversation) {
    throw new LedgerError("Conversation not found", 404, { code: "assistant.conversation_not_found" });
  }
  if (await fetchRunningTurn(conversationId, prisma)) {
    throw new LedgerError("A turn is already running for this conversation", 409, { code: "assistant.turn_running" });
  }
  if (!(await canRetryLastTurn(conversationId, prisma))) {
    throw new LedgerError("The last turn did not fail; nothing to retry", 409, { code: "assistant.nothing_to_retry" });
  }

  return streamTurn(c, { userId, conversationId, retry: true });
}
