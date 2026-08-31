import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import { listRecurring } from "../../services/list-recurring";
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
  path: "/v1/recurring",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List recurring transactions",
  description: "Lists recurring transactions for the authenticated user",
  request: {
    query: z.object({
      businessId: z.string().optional(),
      personalAccountId: z.string().optional(),
      entityType: z.enum(["business", "personal"]).optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(RecurringSchema), "Recurring transactions"),
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
    const query = c.req.valid("query");
    const recurring = await listRecurring(userId, query, prisma);

    return c.json(
      recurring.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        type: r.type,
        amount: r.amount,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        description: r.description,
        category: r.category,
        frequency: r.frequency,
        startDate: toDateString(r.startDate),
        endDate: r.endDate?.toISOString() ?? null,
        nextDueDate: toDateString(r.nextDueDate),
        lastGeneratedDate: r.lastGeneratedDate?.toISOString() ?? null,
        isActive: r.isActive,
        autoGenerateTransaction: r.autoGenerateTransaction,
        reminders: (r.reminders as RemindersConfig | null) ?? null,
        businessId: r.businessId,
        personalAccountId: r.personalAccountId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
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
