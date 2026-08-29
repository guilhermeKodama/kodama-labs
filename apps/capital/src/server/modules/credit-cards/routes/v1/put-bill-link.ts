import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { routeConfig } from "../../constants";
import { linkBillToTransaction } from "../../services/link-bill-transaction";

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

    const updated = await linkBillToTransaction(userId, { billId: id, transactionId }, prisma);

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
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    if (message.includes("already linked")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_SERVER_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
