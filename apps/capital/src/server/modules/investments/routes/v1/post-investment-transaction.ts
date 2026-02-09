import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { createInvestmentTransaction } from "../../services/create-investment-transaction";
import { routeConfig } from "../../constants";

const CreateSchema = z.object({
  holdingId: z.string().min(1),
  type: z.enum([
    "buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal",
  ]),
  quantity: z.number().optional(),
  pricePerUnit: z.number().optional(),
  totalAmount: z.number().positive(),
  fees: z.number().min(0).optional(),
  date: z.string(),
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
  path: "/v1/investment-transactions",
  method: "post",
  tags: [...routeConfig.v1.transactionTags],
  summary: "Create investment transaction",
  request: {
    body: jsonContent(CreateSchema, "Investment transaction data"),
  },
  responses: {
    [CREATED]: jsonContent(ResponseSchema, "Transaction created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid input"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const transaction = await createInvestmentTransaction(
      userId,
      {
        ...body,
        date: parseLocalDate(body.date),
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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("access denied") || message.includes("not found")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
