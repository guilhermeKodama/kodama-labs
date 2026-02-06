import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createCreditCard } from "../../services/create-credit-card";
import { routeConfig } from "../../constants";

const CreateCreditCardSchema = z.object({
  entityType: z.enum(["business", "personal"]),
  bankName: z.string().min(1),
  lastFourDigits: z.string().length(4).regex(/^\d{4}$/),
  nickname: z.string().optional(),
  creditLimit: z.number().positive(),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  color: z.string().optional(),
  currency: z.string().length(3),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
});

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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create credit card",
  description: "Creates a new credit card for the authenticated user",
  request: {
    body: jsonContent(CreateCreditCardSchema, "Credit card creation data"),
  },
  responses: {
    [CREATED]: jsonContent(CreditCardSchema, "Credit card created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const card = await createCreditCard(userId, body, prisma);

    return c.json(
      {
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
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required") || message.includes("access denied") || message.includes("must be")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
