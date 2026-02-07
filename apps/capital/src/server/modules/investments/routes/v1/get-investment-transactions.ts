import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listInvestmentTransactions } from "../../services/list-investment-transactions";
import { routeConfig } from "../../constants";

const InvestmentTransactionTypeValues = z.enum([
  "buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal",
]);

const TransactionSchema = z.object({
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
  holding: z.object({
    id: z.string(),
    name: z.string(),
    ticker: z.string().nullable(),
    assetClass: z.string(),
  }),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-transactions",
  method: "get",
  tags: [...routeConfig.v1.transactionTags],
  summary: "List investment transactions",
  request: {
    query: z.object({
      holdingId: z.string().optional(),
      accountId: z.string().optional(),
      type: InvestmentTransactionTypeValues.optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(TransactionSchema), "Investment transactions retrieved"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const transactions = await listInvestmentTransactions(
      userId,
      {
        ...query,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      },
      prisma
    );

    return c.json(
      transactions.map((t) => ({
        id: t.id,
        holdingId: t.holdingId,
        type: t.type,
        quantity: t.quantity,
        pricePerUnit: t.pricePerUnit,
        totalAmount: t.totalAmount,
        fees: t.fees,
        date: t.date.toISOString(),
        notes: t.notes,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        holding: {
          id: t.holding.id,
          name: t.holding.name,
          ticker: t.holding.ticker,
          assetClass: t.holding.assetClass,
        },
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
