import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { unsubscribeFromPush } from "../../services/unsubscribe";
import { routeConfig } from "../../constants";

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

const SuccessResponseSchema = z.object({
  message: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/push/subscribe",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Unsubscribe from push notifications",
  description: "Removes a Web Push subscription owned by the authenticated user.",
  request: {
    body: jsonContent(UnsubscribeSchema, "Endpoint to remove"),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Subscription removed"),
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
    const body = c.req.valid("json");
    await unsubscribeFromPush(userId, body.endpoint, prisma);

    return c.json({ message: "Subscription removed" }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
