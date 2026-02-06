import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateBudgetService } from "../../services/update-budget";
import { routeConfig } from "../../constants";

const UpdateBudgetSchema = z.object({
  category: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  period: z.enum(["monthly", "yearly"]).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  isActive: z.boolean().optional(),
});

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
  path: "/v1/budgets/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update budget",
  description: "Updates an existing budget for the authenticated user",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateBudgetSchema, "Budget update data"),
  },
  responses: {
    [OK]: jsonContent(BudgetSchema, "Budget updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Budget not found"),
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
    const body = c.req.valid("json");
    const budget = await updateBudgetService(userId, id, body, prisma);

    return c.json(
      {
        id: budget.id,
        entityType: budget.entityType,
        category: budget.category,
        amount: budget.amount,
        currency: budget.currency,
        period: budget.period,
        year: budget.year,
        month: budget.month,
        isActive: budget.isActive,
        businessId: budget.businessId,
        personalAccountId: budget.personalAccountId,
        createdAt: budget.createdAt.toISOString(),
        updatedAt: budget.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Budget not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
