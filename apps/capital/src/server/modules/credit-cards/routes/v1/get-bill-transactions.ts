import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchBillTransactions } from "../../data/queries/fetch-bill-transactions";
import { routeConfig } from "../../constants";

const BillTransactionSchema = z.object({
  id: z.string(),
  billId: z.string(),
  category: z.string(),
  transactionDate: z.string(),
  description: z.string(),
  merchantName: z.string().nullable(),
  amount: z.number(),
  installmentNumber: z.number().nullable(),
  totalInstallments: z.number().nullable(),
  isAutoCategorized: z.boolean(),
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
  path: "/v1/credit-cards/bills/{billId}/transactions",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List bill transactions",
  description: "Lists transactions within a credit card bill",
  request: {
    params: z.object({
      billId: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(BillTransactionSchema), "Bill transactions retrieved"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { billId } = c.req.valid("param");
    const transactions = await fetchBillTransactions(userId, billId, prisma);

    return c.json(
      transactions.map((t) => ({
        id: t.id,
        billId: t.billId,
        category: t.category,
        transactionDate: t.transactionDate.toISOString(),
        description: t.description,
        merchantName: t.merchantName,
        amount: t.amount,
        installmentNumber: t.installmentNumber,
        totalInstallments: t.totalInstallments,
        isAutoCategorized: t.isAutoCategorized,
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
