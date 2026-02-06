import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listBudgets } from "../../services/list-budgets";
import { routeConfig } from "../../constants";

const BudgetSchema = z.object({
  id: z.string(),
  entityType: z.enum(["business", "personal"]),
  category: z.string(),
  amount: z.number(),
  currency: z.string(),
  period: z.enum(["monthly", "yearly"]),
  year: z.number(),
  month: z.number().nullable(),
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
  path: "/v1/budgets",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List budgets",
  description: "Lists budgets for the authenticated user with optional filters",
  request: {
    query: z.object({
      businessId: z.string().optional(),
      personalAccountId: z.string().optional(),
      entityType: z.enum(["business", "personal"]).optional(),
      year: z.coerce.number().optional(),
      month: z.coerce.number().optional(),
      period: z.enum(["monthly", "yearly"]).optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(BudgetSchema), "Budgets retrieved"),
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
    const budgets = await listBudgets(userId, query, prisma);

    return c.json(
      budgets.map((b) => ({
        id: b.id,
        entityType: b.entityType,
        category: b.category,
        amount: b.amount,
        currency: b.currency,
        period: b.period,
        year: b.year,
        month: b.month,
        isActive: b.isActive,
        businessId: b.businessId,
        personalAccountId: b.personalAccountId,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
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
