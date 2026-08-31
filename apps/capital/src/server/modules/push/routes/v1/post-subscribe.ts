import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { subscribeToPush } from "../../services/subscribe";
import { routeConfig } from "../../constants";

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceLabel: z.string().max(100).optional(),
  userAgent: z.string().max(500).optional(),
});

const SubscribeResponseSchema = z.object({
  id: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/push/subscribe",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Subscribe to push notifications",
  description:
    "Registers (or refreshes) a Web Push subscription for the authenticated user. Idempotent upsert by endpoint.",
  request: {
    body: jsonContent(SubscribeSchema, "Push subscription from PushManager.subscribe()"),
  },
  responses: {
    [OK]: jsonContent(SubscribeResponseSchema, "Subscription stored"),
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
    const subscription = await subscribeToPush(
      userId,
      {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        deviceLabel: body.deviceLabel,
        userAgent: body.userAgent,
      },
      prisma
    );

    return c.json({ id: subscription.id }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
