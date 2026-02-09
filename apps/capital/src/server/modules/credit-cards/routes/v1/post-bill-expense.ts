import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createBillExpense } from "../../services/create-bill-expense";
import { routeConfig } from "../../constants";

const CreateBillExpenseSchema = z.object({
  billId: z.string().min(1),
  entityType: z.enum(["business", "personal"]),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  date: z.string(),
});

const TransactionSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number(),
  currency: z.string(),
  description: z.string(),
  category: z.string(),
  date: z.string(),
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
  path: "/v1/credit-cards/bills/expense",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create expense from bill",
  description: "Creates an expense transaction from a credit card bill and links them",
  request: {
    body: jsonContent(CreateBillExpenseSchema, "Bill expense creation data"),
  },
  responses: {
    [CREATED]: jsonContent(TransactionSchema, "Expense created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    const transaction = await createBillExpense(
      userId,
      {
        billId: body.billId,
        entityType: body.entityType,
        businessId: body.businessId,
        personalAccountId: body.personalAccountId,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        date: new Date(body.date + "T12:00:00Z"),
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
        description: transaction.description,
        category: transaction.category,
        date: toDateString(transaction.date),
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
