import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { deleteCurrencyService } from "../../services/delete-currency";
import { routeConfig } from "../../constants";

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
  path: "/v1/currencies/{code}",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Delete currency",
  description: "Deletes a currency for the authenticated user",
  request: {
    params: z.object({
      code: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Currency deleted"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Currency not found"),
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
    const { code } = c.req.valid("param");
    await deleteCurrencyService(userId, code, prisma);

    return c.json({ message: "Currency deleted successfully" }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Currency not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
