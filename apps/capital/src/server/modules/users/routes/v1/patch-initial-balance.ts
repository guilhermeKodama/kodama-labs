import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { routeConfig } from "../../constants";

const PatchSchema = z.object({
  initialBalance: z.number(),
});

const ResponseSchema = z.object({
  id: z.string(),
  initialBalance: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/users/me/initial-balance",
  method: "patch",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update personal account initial balance",
  description: "Updates the initial balance for the current user's personal account",
  request: {
    body: jsonContent(PatchSchema, "Initial balance value"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Initial balance updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Personal account not found"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { initialBalance } = c.req.valid("json");

    const account = await prisma.personalAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Personal account not found" } },
        NOT_FOUND
      );
    }

    const updated = await prisma.personalAccount.update({
      where: { id: account.id },
      data: { initialBalance },
    });

    return c.json(
      { id: updated.id, initialBalance: updated.initialBalance },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
