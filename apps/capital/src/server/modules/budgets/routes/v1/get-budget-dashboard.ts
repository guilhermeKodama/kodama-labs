import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { getBudgetDashboard } from "../../services/get-budget-dashboard";
import { routeConfig } from "../../constants";

const PaceSchema = z.object({
  dailySpendRate: z.number(),
  allowedDailyRate: z.number(),
  projectedTotal: z.number(),
  isOverPace: z.boolean(),
  daysElapsed: z.number(),
  daysRemaining: z.number(),
  daysInPeriod: z.number(),
});

const BudgetProgressSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  entityType: z.string(),
  category: z.string(),
  amount: z.number(),
  currency: z.string(),
  period: z.string(),
  year: z.number(),
  month: z.number().nullable(),
  spent: z.number(),
  remaining: z.number(),
  percentUsed: z.number(),
  isOverBudget: z.boolean(),
  isActive: z.boolean(),
  pace: PaceSchema,
});

const InsightSchema = z.object({
  budgetId: z.string(),
  category: z.string(),
  severity: z.enum(["critical", "warning", "good"]),
  message: z.string(),
  recommendation: z.string(),
  percentUsed: z.number(),
  remaining: z.number(),
  daysRemaining: z.number(),
  dailySpendRate: z.number(),
  allowedDailyRate: z.number(),
});

const UnbudgetedSchema = z.object({
  category: z.string(),
  totalSpent: z.number(),
  transactionCount: z.number(),
  entityId: z.string(),
  entityType: z.string(),
  isFromPreviousMonth: z.boolean(),
});

const MonthOverMonthSchema = z.object({
  category: z.string(),
  entityId: z.string(),
  currentSpent: z.number(),
  previousSpent: z.number(),
  changeAmount: z.number(),
  changePercent: z.number(),
});

const DashboardResponseSchema = z.object({
  period: z.object({ year: z.number(), month: z.number() }),
  summary: z.object({
    totalBudget: z.number(),
    totalSpent: z.number(),
    totalRoom: z.number(),
    projectedTotal: z.number(),
  }),
  budgets: z.array(BudgetProgressSchema),
  insights: z.array(InsightSchema),
  unbudgetedSpending: z.array(UnbudgetedSchema),
  monthOverMonth: z.array(MonthOverMonthSchema),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/budgets/dashboard",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get budget dashboard",
  description: "Returns comprehensive budget progress, insights, and spending analysis for a given period",
  request: {
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(DashboardResponseSchema, "Budget dashboard data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { year, month } = c.req.valid("query");

    // Get user's timezone
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone ?? "America/Sao_Paulo";

    const dashboard = await getBudgetDashboard(
      userId,
      { year, month, timezone },
      prisma
    );

    return c.json(dashboard, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
