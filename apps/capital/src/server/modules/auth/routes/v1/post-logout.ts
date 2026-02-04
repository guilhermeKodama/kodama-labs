import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { getCookie, deleteCookie } from "hono/cookie";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { deleteSession } from "../../services/session";
import { routeConfig, SESSION_COOKIE_NAME } from "../../constants";

const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/auth/logout",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Log out a user",
  description: "Ends the current session and clears the session cookie",
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Logout successful"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);

    if (sessionId) {
      await deleteSession(sessionId, prisma);
    }

    // Clear the session cookie
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: "/",
    });

    return c.json({ success: true }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
