import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { updateTransactionService } from "../../services/update-transaction";
import { routeConfig } from "../../constants";

const UpdateTransactionSchema = z.object({
  type: z.enum(["income", "expense", "investment"]).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  date: z.string().optional(),
  isTaxDeductible: z.boolean().optional(),
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
  path: "/v1/transactions/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update transaction",
  description: "Updates an existing transaction",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateTransactionSchema, "Transaction update data"),
  },
  responses: {
    [OK]: jsonContent(TransactionSchema, "Transaction updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Transaction not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const transaction = await updateTransactionService(
      id,
      {
        ...body,
        date: body.date ? new Date(body.date) : undefined,
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
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transaction not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
