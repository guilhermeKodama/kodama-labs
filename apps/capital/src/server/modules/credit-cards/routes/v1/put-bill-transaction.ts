import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateBillTransaction } from "../../data/commands/update-bill-transaction";
import { routeConfig } from "../../constants";

const UpdateBillTransactionSchema = z.object({
  category: z.string().min(1),
});

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
  path: "/v1/credit-cards/bills/transactions/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update bill transaction category",
  description: "Updates the category of a bill transaction",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateBillTransactionSchema, "Bill transaction update data"),
  },
  responses: {
    [OK]: jsonContent(BillTransactionSchema, "Bill transaction updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Bill transaction not found"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tx = await updateBillTransaction(userId, id, body, prisma);

    return c.json(
      {
        id: tx.id,
        billId: tx.billId,
        category: tx.category,
        transactionDate: toDateString(tx.transactionDate),
        description: tx.description,
        merchantName: tx.merchantName,
        amount: tx.amount,
        installmentNumber: tx.installmentNumber,
        totalInstallments: tx.totalInstallments,
        isAutoCategorized: tx.isAutoCategorized,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Bill transaction not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
