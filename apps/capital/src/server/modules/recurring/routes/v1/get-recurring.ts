import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
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
  description: "Lists recurring transactions with optional filters",
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
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const query = c.req.valid("query");
    const recurring = await listRecurring(query, prisma);

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
        startDate: r.startDate.toISOString(),
        endDate: r.endDate?.toISOString() ?? null,
        nextDueDate: r.nextDueDate.toISOString(),
        lastGeneratedDate: r.lastGeneratedDate?.toISOString() ?? null,
        isActive: r.isActive,
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
