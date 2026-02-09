import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { updateInvestmentTransactionService } from "../../services/update-investment-transaction";
import { routeConfig } from "../../constants";

const UpdateSchema = z.object({
  type: z.enum([
    "buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal",
  ]).optional(),
  quantity: z.number().optional(),
  pricePerUnit: z.number().optional(),
  totalAmount: z.number().positive().optional(),
  fees: z.number().min(0).optional(),
  date: z.string().optional(),
  notes: z.string().optional(),
});

const ResponseSchema = z.object({
  id: z.string(),
  holdingId: z.string(),
  type: z.string(),
  quantity: z.number().nullable(),
  pricePerUnit: z.number().nullable(),
  totalAmount: z.number(),
  fees: z.number(),
  date: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-transactions/{id}",
  method: "put",
  tags: [...routeConfig.v1.transactionTags],
  summary: "Update investment transaction",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateSchema, "Transaction update data"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Transaction updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const transaction = await updateInvestmentTransactionService(
      userId,
      id,
      {
        ...body,
        date: body.date ? parseLocalDate(body.date) : undefined,
      },
      prisma
    );

    return c.json(
      {
        id: transaction.id,
        holdingId: transaction.holdingId,
        type: transaction.type,
        quantity: transaction.quantity,
        pricePerUnit: transaction.pricePerUnit,
        totalAmount: transaction.totalAmount,
        fees: transaction.fees,
        date: toDateString(transaction.date),
        notes: transaction.notes,
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
