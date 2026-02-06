import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { routeConfig } from "../../constants";

const LinkBillSchema = z.object({
  transactionId: z.string().min(1),
});

const BillResponseSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  status: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/credit-cards/bills/{id}/link",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(LinkBillSchema, "Transaction to link"),
  },
  responses: {
    [OK]: jsonContent(BillResponseSchema, "Bill linked"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Bill not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Bad request"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Unauthorized"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const { transactionId } = c.req.valid("json");

    // Verify bill ownership
    const bill = await prisma.creditCardBill.findFirst({
      where: {
        id,
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
      select: { id: true, transactionId: true },
    });

    if (!bill) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Bill not found" } },
        NOT_FOUND
      );
    }

    if (bill.transactionId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Bill is already linked to a transaction" } },
        BAD_REQUEST
      );
    }

    // Verify the transaction exists and belongs to the user
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { id: true },
    });

    if (!transaction) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Transaction not found" } },
        NOT_FOUND
      );
    }

    // Link the bill to the transaction and mark as paid
    const updated = await prisma.creditCardBill.update({
      where: { id },
      data: {
        transactionId,
        status: "paid",
      },
    });

    return c.json(
      {
        id: updated.id,
        transactionId: updated.transactionId!,
        status: updated.status,
      },
      OK
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_SERVER_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
