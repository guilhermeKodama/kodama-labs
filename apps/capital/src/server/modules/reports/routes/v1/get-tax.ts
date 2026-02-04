import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { getTaxReport } from "../../services/get-tax-report";
import { routeConfig } from "../../constants";

const TaxSummarySchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  totalIncome: z.number(),
  totalDeductible: z.number(),
  taxableIncome: z.number(),
  estimatedTax: z.number(),
  taxRate: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/reports/tax",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get tax report",
  description: "Gets tax calculations for all businesses for a given year",
  request: {
    query: z.object({
      userId: z.string(),
      year: z.coerce.number().int().min(2000).max(2100),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(TaxSummarySchema), "Tax report"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { userId, year } = c.req.valid("query");
    const taxSummaries = await getTaxReport({ userId, year }, prisma);

    return c.json(taxSummaries, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
