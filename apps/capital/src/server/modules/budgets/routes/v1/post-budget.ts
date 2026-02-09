import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createBudget } from "../../services/create-budget";
import { routeConfig } from "../../constants";

const CreateBudgetSchema = z.object({
  entityType: z.enum(["business", "personal"]),
  category: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
  period: z.enum(["monthly", "yearly"]),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12).optional(),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
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
  path: "/v1/budgets",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create budget",
  description: "Creates a new budget for the authenticated user",
  request: {
    body: jsonContent(CreateBudgetSchema, "Budget creation data"),
  },
  responses: {
    [CREATED]: jsonContent(BudgetSchema, "Budget created"),
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
    const budget = await createBudget(userId, body, prisma);

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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("required") ||
      message.includes("access denied") ||
      message.includes("already exists") ||
      message.includes("Unique constraint")
    ) {
      const userMessage = message.includes("Unique constraint")
        ? "A budget with this category already exists for this period."
        : message;
      return c.json({ error: { code: "BAD_REQUEST", message: userMessage } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
