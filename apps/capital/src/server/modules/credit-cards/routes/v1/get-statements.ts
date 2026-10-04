import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchStatements } from "../../data/queries/fetch-statements";
import { routeConfig } from "../../constants";

const PurchaseSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  category: z.string(),
  description: z.string(),
  transactionDate: z.string(),
});

const StatementSchema = z.object({
  id: z.string(),
  month: z.string(),
  closingDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  totalAmount: z.number().nullable(),
  billPaymentTransactionId: z.string().nullable(),
  creditCard: z.object({
    id: z.string(),
    entityId: z.string(),
    entityType: z.enum(["business", "personal"]),
    currency: z.string(),
  }),
  purchases: z.array(PurchaseSchema),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/credit-cards/statements",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List credit card statements with purchases",
  description:
    "Returns credit card statements for the authenticated user, including purchases. Optional from/to are YYYY-MM bounds on the statement month.",
  request: {
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(StatementSchema), "Statements retrieved"),
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
    const { from, to } = c.req.valid("query");
    const statements = await fetchStatements(userId, prisma, { from, to });

    return c.json(
      statements.map((statement) => ({
        id: statement.id,
        month: statement.month,
        closingDate: statement.closingDate
          ? statement.closingDate.toISOString()
          : null,
        dueDate: statement.dueDate ? statement.dueDate.toISOString() : null,
        totalAmount: statement.totalAmount,
        billPaymentTransactionId: statement.billPaymentTransactionId,
        creditCard: {
          id: statement.creditCard.id,
          entityId:
            statement.creditCard.businessId ??
            statement.creditCard.personalAccountId ??
            "",
          entityType: statement.creditCard.entityType,
          currency: statement.creditCard.currency,
        },
        purchases: statement.purchases.map((purchase) => ({
          id: purchase.id,
          amount: purchase.amount,
          currency: purchase.currency,
          category: purchase.category,
          description: purchase.description,
          transactionDate: purchase.transactionDate.toISOString(),
        })),
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
