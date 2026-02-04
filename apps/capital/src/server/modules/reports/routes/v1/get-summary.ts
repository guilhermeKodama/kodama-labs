import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { getSummary } from "../../services/get-summary";
import { routeConfig } from "../../constants";

const EntitySummarySchema = z.object({
  entityId: z.string(),
  entityType: z.enum(["business", "personal"]),
  entityName: z.string(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  totalInvestments: z.number(),
  balance: z.number(),
  netWorth: z.number(),
  currency: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/reports/summary",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get financial summary",
  description:
    "Gets a financial summary for all entities (businesses and personal)",
  request: {
    query: z.object({
      userId: z.string(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(EntitySummarySchema), "Financial summary"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { userId, dateFrom, dateTo } = c.req.valid("query");
    const summaries = await getSummary(
      {
        userId,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      },
      prisma
    );

    return c.json(summaries, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
