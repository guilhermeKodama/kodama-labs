import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchBills } from "../../data/queries/fetch-bills";
import { routeConfig } from "../../constants";

const BillSchema = z.object({
  id: z.string(),
  creditCardId: z.string(),
  transactionId: z.string().nullable(),
  closingDate: z.string(),
  dueDate: z.string(),
  totalAmount: z.number(),
  status: z.enum(["pending", "paid", "overdue"]),
  categorizationStatus: z.string(),
  csvFileName: z.string().nullable(),
  creditCard: z.object({
    id: z.string(),
    bankName: z.string(),
    lastFourDigits: z.string(),
    nickname: z.string().nullable(),
    color: z.string(),
  }),
  transactionCount: z.number(),
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
  path: "/v1/credit-cards/bills",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List credit card bills",
  description: "Lists credit card bills for the authenticated user",
  request: {
    query: z.object({
      creditCardId: z.string().optional(),
      status: z.enum(["pending", "paid", "overdue"]).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(BillSchema), "Bills retrieved"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const bills = await fetchBills(userId, query, prisma);

    return c.json(
      bills.map((bill) => ({
        id: bill.id,
        creditCardId: bill.creditCardId,
        transactionId: bill.transactionId,
        closingDate: toDateString(bill.closingDate),
        dueDate: toDateString(bill.dueDate),
        totalAmount: bill.totalAmount,
        status: bill.status,
        categorizationStatus: bill.categorizationStatus,
        csvFileName: bill.csvFileName,
        creditCard: {
          id: bill.creditCard.id,
          bankName: bill.creditCard.bankName,
          lastFourDigits: bill.creditCard.lastFourDigits,
          nickname: bill.creditCard.nickname,
          color: bill.creditCard.color,
        },
        transactionCount: bill._count.billTransactions,
        createdAt: bill.createdAt.toISOString(),
        updatedAt: bill.updatedAt.toISOString(),
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
