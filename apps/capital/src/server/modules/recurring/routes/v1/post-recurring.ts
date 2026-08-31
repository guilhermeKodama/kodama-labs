import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import { createRecurring } from "../../services/create-recurring";
import { routeConfig } from "../../constants";

const CreateRecurringSchema = z.object({
  entityType: z.enum(["business", "personal"]),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number().positive(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  description: z.string().min(1),
  category: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string(),
  endDate: z.string().optional(),
  autoGenerateTransaction: z.boolean().optional(),
  reminders: remindersConfigSchema.optional(),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
});

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
  path: "/v1/recurring",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create recurring transaction",
  description: "Creates a new recurring transaction for the authenticated user",
  request: {
    body: jsonContent(CreateRecurringSchema, "Recurring transaction data"),
  },
  responses: {
    [CREATED]: jsonContent(RecurringSchema, "Recurring transaction created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
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
    const body = c.req.valid("json");
    const recurring = await createRecurring(
      userId,
      {
        ...body,
        startDate: parseLocalDate(body.startDate),
        endDate: body.endDate ? parseLocalDate(body.endDate) : undefined,
      },
      prisma
    );

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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
