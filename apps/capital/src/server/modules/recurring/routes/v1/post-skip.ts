import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import { skipRecurringOccurrence } from "../../services/skip-occurrence";
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
  reminders: remindersConfigSchema.nullable(),
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
  path: "/v1/recurring/{id}/skip",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Skip recurring transaction occurrence",
  description:
    "Advances the current occurrence to the next due date WITHOUT creating a transaction. Use for reminder-mode entries that don't need a booked transaction this cycle but should stop nagging.",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(RecurringSchema, "Occurrence skipped, recurring advanced"),
    [NOT_FOUND]: jsonContent(
      ErrorResponseSchema,
      "Recurring transaction not found"
    ),
    [BAD_REQUEST]: jsonContent(
      ErrorResponseSchema,
      "Recurring transaction is not active"
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
    const recurring = await skipRecurringOccurrence(userId, id, prisma);

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
        reminders: (recurring.reminders as RemindersConfig | null) ?? null,
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
    if (message.includes("not active")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
