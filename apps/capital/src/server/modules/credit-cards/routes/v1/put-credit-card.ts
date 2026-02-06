import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateCreditCardService } from "../../services/update-credit-card";
import { routeConfig } from "../../constants";

const UpdateCreditCardSchema = z.object({
  bankName: z.string().min(1).optional(),
  lastFourDigits: z.string().length(4).regex(/^\d{4}$/).optional(),
  nickname: z.string().optional(),
  creditLimit: z.number().positive().optional(),
  closingDay: z.number().int().min(1).max(31).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  color: z.string().optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
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
  path: "/v1/credit-cards/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update credit card",
  description: "Updates a credit card for the authenticated user",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateCreditCardSchema, "Credit card update data"),
  },
  responses: {
    [OK]: jsonContent(CreditCardSchema, "Credit card updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Credit card not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const card = await updateCreditCardService(userId, id, body, prisma);

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
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Credit card not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    if (message.includes("must be")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
