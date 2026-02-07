import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createInvestmentHolding } from "../../services/create-investment-holding";
import { routeConfig } from "../../constants";

const CreateSchema = z.object({
  accountId: z.string().min(1),
  assetClass: z.enum([
    "stocks", "fii", "etf", "bdr", "fixed_income", "crypto",
    "savings", "international_stocks", "international_etf",
  ]),
  subType: z.enum([
    "cdb", "rdb", "lci", "lca", "cdi", "tesouro_selic",
    "tesouro_ipca", "tesouro_prefixado", "debenture",
  ]).optional(),
  ticker: z.string().optional(),
  name: z.string().min(1),
  currency: z.string().length(3),
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
  path: "/v1/investment-holdings",
  method: "post",
  tags: [...routeConfig.v1.holdingTags],
  summary: "Create investment holding",
  request: {
    body: jsonContent(CreateSchema, "Investment holding data"),
  },
  responses: {
    [CREATED]: jsonContent(ResponseSchema, "Holding created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid input"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const holding = await createInvestmentHolding(userId, body, prisma);

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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("access denied") || message.includes("not found")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
