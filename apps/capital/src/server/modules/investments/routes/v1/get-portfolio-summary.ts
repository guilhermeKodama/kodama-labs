import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { getPortfolioSummary } from "../../services/get-portfolio-summary";
import { routeConfig } from "../../constants";

const SummarySchema = z.object({
  totalInvested: z.number(),
  totalByAssetClass: z.record(z.number()),
  holdingsCount: z.number(),
  accountsCount: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-portfolio/summary",
  method: "get",
  tags: [...routeConfig.v1.holdingTags],
  summary: "Get portfolio summary",
  responses: {
    [OK]: jsonContent(SummarySchema, "Portfolio summary"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const summary = await getPortfolioSummary(userId, prisma);
    return c.json(summary, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
