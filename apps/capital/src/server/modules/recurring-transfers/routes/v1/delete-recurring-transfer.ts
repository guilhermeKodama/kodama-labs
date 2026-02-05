import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { deleteRecurringTransfer } from "../../services/delete-recurring-transfer";
import { routeConfig } from "../../constants";

const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/recurring-transfers/{id}",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Delete recurring transfer",
  description: "Deletes a recurring transfer",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Recurring transfer deleted"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Recurring transfer not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    await deleteRecurringTransfer(id, prisma);

    return c.json(
      { success: true, message: "Recurring transfer deleted successfully" },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("Record to delete does not exist")) {
      return c.json({ error: { code: "NOT_FOUND", message: "Recurring transfer not found" } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
