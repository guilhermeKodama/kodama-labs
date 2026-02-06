import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { markRecurringAsPaid } from "../../services/mark-paid";
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
  recurringTransactionId: z.string().nullable(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RecurringSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string(),
  category: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
  nextDueDate: z.string(),
  lastGeneratedDate: z.string().nullable(),
  isActive: z.boolean(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ResponseSchema = z.object({
  transaction: TransactionSchema,
  recurring: RecurringSchema,
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/recurring/{id}/mark-paid",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Mark recurring transaction as paid",
  description:
    "Creates a transaction for the current due date and advances to the next occurrence for the authenticated user",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Transaction created and recurring updated"),
    [NOT_FOUND]: jsonContent(
      ErrorResponseSchema,
      "Recurring transaction not found"
    ),
    [BAD_REQUEST]: jsonContent(
      ErrorResponseSchema,
      "Recurring transaction is not active"
    ),
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
    const { id } = c.req.valid("param");
    const result = await markRecurringAsPaid(userId, id, prisma);

    return c.json(
      {
        transaction: {
          id: result.transaction.id,
          entityType: result.transaction.entityType,
          type: result.transaction.type,
          amount: result.transaction.amount,
          currency: result.transaction.currency,
          exchangeRate: result.transaction.exchangeRate,
          description: result.transaction.description,
          category: result.transaction.category,
          date: result.transaction.date.toISOString(),
          isTaxDeductible: result.transaction.isTaxDeductible,
          recurringTransactionId: result.transaction.recurringTransactionId,
          businessId: result.transaction.businessId,
          personalAccountId: result.transaction.personalAccountId,
          createdAt: result.transaction.createdAt.toISOString(),
          updatedAt: result.transaction.updatedAt.toISOString(),
        },
        recurring: {
          id: result.recurring.id,
          entityType: result.recurring.entityType,
          type: result.recurring.type,
          amount: result.recurring.amount,
          currency: result.recurring.currency,
          exchangeRate: result.recurring.exchangeRate,
          description: result.recurring.description,
          category: result.recurring.category,
          frequency: result.recurring.frequency,
          startDate: result.recurring.startDate.toISOString(),
          endDate: result.recurring.endDate?.toISOString() ?? null,
          nextDueDate: result.recurring.nextDueDate.toISOString(),
          lastGeneratedDate:
            result.recurring.lastGeneratedDate?.toISOString() ?? null,
          isActive: result.recurring.isActive,
          businessId: result.recurring.businessId,
          personalAccountId: result.recurring.personalAccountId,
          createdAt: result.recurring.createdAt.toISOString(),
          updatedAt: result.recurring.updatedAt.toISOString(),
        },
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    if (message.includes("not active")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
