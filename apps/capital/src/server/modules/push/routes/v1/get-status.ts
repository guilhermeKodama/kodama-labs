import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { isPushConfigured } from "@capital/server/lib/web-push";
import { routeConfig } from "../../constants";

const StatusSchema = z.object({
  /** Whether the server has VAPID keys configured at all. */
  configured: z.boolean(),
  /** Live (non-dead) subscriptions for the authenticated user. */
  deviceCount: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/push/status",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Push notification status",
  description: "Whether push is configured server-side and how many live devices the user has subscribed.",
  responses: {
    [OK]: jsonContent(StatusSchema, "Push status"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const deviceCount = await prisma.pushSubscription.count({
      where: { userId, deadAt: null },
    });

    return c.json({ configured: isPushConfigured(), deviceCount }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
