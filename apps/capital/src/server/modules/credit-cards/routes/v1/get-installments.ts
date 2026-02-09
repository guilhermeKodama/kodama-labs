import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchInstallments } from "../../data/queries/fetch-installments";
import { routeConfig } from "../../constants";

const InstallmentSchema = z.object({
  id: z.string(),
  creditCardId: z.string(),
  billTransactionId: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  totalAmount: z.number(),
  totalInstallments: z.number(),
  paidInstallments: z.number(),
  remainingInstallments: z.number(),
  startDate: z.string(),
  installmentAmount: z.number(),
  isActive: z.boolean(),
  creditCard: z.object({
    id: z.string(),
    bankName: z.string(),
    lastFourDigits: z.string(),
    nickname: z.string().nullable(),
    color: z.string(),
  }),
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
  path: "/v1/credit-cards/installments",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List installments",
  description: "Lists credit card installments for the authenticated user",
  request: {
    query: z.object({
      creditCardId: z.string().optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(InstallmentSchema), "Installments retrieved"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const installments = await fetchInstallments(userId, query, prisma);

    return c.json(
      installments.map((inst) => ({
        id: inst.id,
        creditCardId: inst.creditCardId,
        billTransactionId: inst.billTransactionId,
        description: inst.description,
        category: inst.billTransaction?.category ?? null,
        totalAmount: inst.totalAmount,
        totalInstallments: inst.totalInstallments,
        paidInstallments: inst.paidInstallments,
        remainingInstallments: inst.totalInstallments - inst.paidInstallments,
        startDate: toDateString(inst.startDate),
        installmentAmount: inst.installmentAmount,
        isActive: inst.isActive,
        creditCard: {
          id: inst.creditCard.id,
          bankName: inst.creditCard.bankName,
          lastFourDigits: inst.creditCard.lastFourDigits,
          nickname: inst.creditCard.nickname,
          color: inst.creditCard.color,
        },
        createdAt: inst.createdAt.toISOString(),
        updatedAt: inst.updatedAt.toISOString(),
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
