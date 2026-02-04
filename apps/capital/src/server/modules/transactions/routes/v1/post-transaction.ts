import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { createTransaction } from "../../services/create-transaction";
import { routeConfig } from "../../constants";

const CreateTransactionSchema = z.object({
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number().positive(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  description: z.string().min(1),
  category: z.string().min(1),
  date: z.string(),
  isTaxDeductible: z.boolean().optional(),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
  recurringTransactionId: z.string().optional(),
});

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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create transaction",
  description: "Creates a new transaction",
  request: {
    body: jsonContent(CreateTransactionSchema, "Transaction creation data"),
  },
  responses: {
    [CREATED]: jsonContent(TransactionSchema, "Transaction created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const body = c.req.valid("json");
    const transaction = await createTransaction(
      {
        ...body,
        date: new Date(body.date),
      },
      prisma
    );

    return c.json(
      {
        id: transaction.id,
        entityType: transaction.entityType,
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency,
        exchangeRate: transaction.exchangeRate,
        description: transaction.description,
        category: transaction.category,
        date: transaction.date.toISOString(),
        isTaxDeductible: transaction.isTaxDeductible,
        businessId: transaction.businessId,
        personalAccountId: transaction.personalAccountId,
        recurringTransactionId: transaction.recurringTransactionId,
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
