import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { routeConfig } from "../../constants";
import { updateBill } from "../../services/update-bill";

const UpdateBillSchema = z.object({
  closingDate: z.string().optional(),
  dueDate: z.string().optional(),
});

const BillResponseSchema = z.object({
  id: z.string(),
  closingDate: z.string(),
  dueDate: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/credit-cards/bills/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update credit card bill",
  description: "Corrects a bill's own closingDate/dueDate (does not affect the card's recurring day)",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateBillSchema, "Bill fields to update"),
  },
  responses: {
    [OK]: jsonContent(BillResponseSchema, "Bill updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Bill not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updated = await updateBill(
      userId,
      id,
      {
        closingDate: body.closingDate ? new Date(body.closingDate + "T12:00:00Z") : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate + "T12:00:00Z") : undefined,
      },
      prisma
    );

    return c.json(
      {
        id: updated.id,
        closingDate: toDateString(updated.closingDate),
        dueDate: toDateString(updated.dueDate),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
