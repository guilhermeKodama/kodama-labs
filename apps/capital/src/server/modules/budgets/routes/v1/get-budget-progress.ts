import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { getBudgetProgress } from "../../services/get-budget-progress";
import { routeConfig } from "../../constants";

const BudgetProgressSchema = z.object({
  budgetId: z.string(),
  category: z.string(),
  budgetAmount: z.number(),
  spent: z.number(),
  remaining: z.number(),
  percentUsed: z.number(),
  isOverBudget: z.boolean(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/budgets/{id}/progress",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get budget progress",
  description: "Gets the spending progress for a budget",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(BudgetProgressSchema, "Budget progress retrieved"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Budget not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    const progress = await getBudgetProgress(id, prisma);

    return c.json(progress, OK);
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
