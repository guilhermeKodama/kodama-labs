import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateInvestmentHoldingService } from "../../services/update-investment-holding";
import { routeConfig } from "../../constants";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  ticker: z.string().optional(),
  assetClass: z.enum([
    "stocks", "fii", "etf", "bdr", "fixed_income", "crypto",
    "savings", "international_stocks", "international_etf",
  ]).optional(),
  subType: z.enum([
    "cdb", "rdb", "lci", "lca", "cdi", "tesouro_selic",
    "tesouro_ipca", "tesouro_prefixado", "debenture",
  ]).optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
});

const ResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  assetClass: z.string(),
  subType: z.string().nullable(),
  ticker: z.string().nullable(),
  name: z.string(),
  currency: z.string(),
  currentQuantity: z.number(),
  averageCost: z.number(),
  totalInvested: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-holdings/{id}",
  method: "put",
  tags: [...routeConfig.v1.holdingTags],
  summary: "Update investment holding",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateSchema, "Holding update data"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Holding updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const holding = await updateInvestmentHoldingService(userId, id, body, prisma);

    return c.json(
      {
        id: holding.id,
        accountId: holding.accountId,
        assetClass: holding.assetClass,
        subType: holding.subType,
        ticker: holding.ticker,
        name: holding.name,
        currency: holding.currency,
        currentQuantity: holding.currentQuantity,
        averageCost: holding.averageCost,
        totalInvested: holding.totalInvested,
        isActive: holding.isActive,
        createdAt: holding.createdAt.toISOString(),
        updatedAt: holding.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
