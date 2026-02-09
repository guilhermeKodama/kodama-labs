import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listTransactions } from "../../services/list-transactions";
import { routeConfig } from "../../constants";

const TransactionSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string(),
  category: z.string(),
  date: z.string(),
  isTaxDeductible: z.boolean(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  recurringTransactionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/transactions",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List transactions",
  description: "Lists transactions for the authenticated user with optional filters",
  request: {
    query: z.object({
      businessId: z.string().optional(),
      personalAccountId: z.string().optional(),
      entityType: z.enum(["business", "personal"]).optional(),
      type: z.enum(["income", "expense", "investment"]).optional(),
      category: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(TransactionSchema), "Transactions retrieved"),
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
    const query = c.req.valid("query");
    const transactions = await listTransactions(
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
        entityType: t.entityType,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        exchangeRate: t.exchangeRate,
        description: t.description,
        category: t.category,
        date: toDateString(t.date),
        isTaxDeductible: t.isTaxDeductible,
        businessId: t.businessId,
        personalAccountId: t.personalAccountId,
        recurringTransactionId: t.recurringTransactionId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
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
