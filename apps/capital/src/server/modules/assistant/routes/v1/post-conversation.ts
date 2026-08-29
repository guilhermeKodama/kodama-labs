import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createConversation } from "../../services/create-conversation";
import { routeConfig } from "../../constants";

const CreateConversationSchema = z.object({
  title: z.string().min(1).optional(),
});

const ConversationSchema = z.object({
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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create a conversation",
  description: "Starts a new assistant conversation for the authenticated user",
  request: {
    body: jsonContent(CreateConversationSchema, "Optional initial title"),
  },
  responses: {
    [CREATED]: jsonContent(ConversationSchema, "Conversation created"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const conversation = await createConversation(userId, body, prisma);

    return c.json(
      {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        createdAt: conversation.createdAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
