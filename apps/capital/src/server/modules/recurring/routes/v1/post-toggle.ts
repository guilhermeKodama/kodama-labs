import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { toggleRecurring } from "../../services/toggle-recurring";
import { routeConfig } from "../../constants";

const RecurringSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string(),
  category: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
  nextDueDate: z.string(),
  lastGeneratedDate: z.string().nullable(),
  isActive: z.boolean(),
  autoGenerateTransaction: z.boolean(),
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
  path: "/v1/recurring/{id}/toggle",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Toggle recurring transaction",
  description: "Toggles the active state of a recurring transaction for the authenticated user",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(RecurringSchema, "Recurring transaction toggled"),
    [NOT_FOUND]: jsonContent(
      ErrorResponseSchema,
      "Recurring transaction not found"
    ),
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
    const { id } = c.req.valid("param");
    const recurring = await toggleRecurring(userId, id, prisma);

    return c.json(
      {
        id: recurring.id,
        entityType: recurring.entityType,
        type: recurring.type,
        amount: recurring.amount,
        currency: recurring.currency,
        exchangeRate: recurring.exchangeRate,
        description: recurring.description,
        category: recurring.category,
        frequency: recurring.frequency,
        startDate: toDateString(recurring.startDate),
        endDate: recurring.endDate?.toISOString() ?? null,
        nextDueDate: toDateString(recurring.nextDueDate),
        lastGeneratedDate: recurring.lastGeneratedDate?.toISOString() ?? null,
        isActive: recurring.isActive,
        autoGenerateTransaction: recurring.autoGenerateTransaction,
        businessId: recurring.businessId,
        personalAccountId: recurring.personalAccountId,
        createdAt: recurring.createdAt.toISOString(),
        updatedAt: recurring.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
