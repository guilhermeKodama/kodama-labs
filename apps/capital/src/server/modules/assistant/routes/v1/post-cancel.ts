import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { fetchConversationById } from "../../data/queries/fetch-conversations";
import { fetchRunningTurn } from "../../data/queries/fetch-message-history";
import { updateAgentTurn } from "../../data/commands/manage-agent-turn";
import { routeConfig } from "../../constants";

const SuccessResponseSchema = z.object({ message: z.string(), turnId: z.string().nullable() });

export const route = createRoute({
  path: "/v1/assistant/conversations/{id}/cancel",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Cancel the running turn",
  description:
    "Marks the conversation's in-flight turn as cancelled - the loop observes this between iterations and stops cleanly",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Turn cancelled (or none was running)"),
    [NOT_FOUND]: jsonContent(ApiErrorSchema, "Conversation not found"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const { id: conversationId } = c.req.valid("param");

  const conversation = await fetchConversationById(userId, conversationId, prisma);
  if (!conversation) {
    throw new LedgerError("Conversation not found", 404, { code: "assistant.conversation_not_found" });
  }

  const running = await fetchRunningTurn(conversationId, prisma);
  if (!running) {
    return c.json({ message: "No turn was running", turnId: null }, OK);
  }

  await updateAgentTurn(running.id, { status: "cancelled" }, prisma);
  return c.json({ message: "Turn cancelled", turnId: running.id }, OK);
};
