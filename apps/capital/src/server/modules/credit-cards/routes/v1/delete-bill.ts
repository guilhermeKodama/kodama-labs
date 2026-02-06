import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { deleteBill } from "../../data/commands/delete-bill";
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
  path: "/v1/credit-cards/bills/{id}",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Delete credit card bill",
  description: "Deletes a credit card bill and all its transactions",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Bill deleted"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Bill not found"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    await deleteBill(userId, id, prisma);

    return c.json({ message: "Bill deleted successfully" }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Bill not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
