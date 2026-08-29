import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listConversations } from "../../services/list-conversations";
import { routeConfig } from "../../constants";

const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  lastMessageAt: z.string(),
  createdAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/assistant/conversations",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List conversations",
  description: "Lists the authenticated user's conversations, most recent first",
  request: {
    query: z.object({
      limit: z.coerce.number().int().positive().max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(ConversationSummarySchema), "Conversations retrieved"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const conversations = await listConversations(userId, query, prisma);

    return c.json(
      conversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        status: conv.status,
        lastMessageAt: conv.lastMessageAt.toISOString(),
        createdAt: conv.createdAt.toISOString(),
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
