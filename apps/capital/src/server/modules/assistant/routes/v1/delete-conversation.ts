import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { archiveConversation } from "../../services/archive-conversation";
import { routeConfig } from "../../constants";

const SuccessResponseSchema = z.object({ message: z.string() });

export const route = createRoute({
  path: "/v1/assistant/conversations/{id}",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Archive a conversation",
  description: "Soft-deletes (archives) a conversation for the authenticated user",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Conversation archived"),
    [NOT_FOUND]: jsonContent(ApiErrorSchema, "Conversation not found"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  await archiveConversation(userId, id, prisma);

  return c.json({ message: "Conversation archived" }, OK);
};
