import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { fetchCreditCards } from "../../data/queries/fetch-credit-cards";
import { routeConfig } from "../../constants";

const CreditCardSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  bankName: z.string(),
  lastFourDigits: z.string(),
  nickname: z.string().nullable(),
  creditLimit: z.number(),
  closingDay: z.number(),
  dueDay: z.number(),
  color: z.string(),
  currency: z.string(),
  isActive: z.boolean(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
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
  path: "/v1/credit-cards",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List credit cards",
  description: "Lists credit cards for the authenticated user with optional filters",
  request: {
    query: z.object({
      businessId: z.string().optional(),
      personalAccountId: z.string().optional(),
      entityType: z.enum(["business", "personal"]).optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(CreditCardSchema), "Credit cards retrieved"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const cards = await fetchCreditCards(userId, query, prisma);

    return c.json(
      cards.map((card) => ({
        id: card.id,
        entityType: card.entityType,
        bankName: card.bankName,
        lastFourDigits: card.lastFourDigits,
        nickname: card.nickname,
        creditLimit: card.creditLimit,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        color: card.color,
        currency: card.currency,
        isActive: card.isActive,
        businessId: card.businessId,
        personalAccountId: card.personalAccountId,
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
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
