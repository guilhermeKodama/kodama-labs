import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listInvestmentHoldings } from "../../services/list-investment-holdings";
import { routeConfig } from "../../constants";

const AssetClassValues = z.enum([
  "stocks", "fii", "etf", "bdr", "fixed_income", "crypto",
  "savings", "international_stocks", "international_etf",
]);

const HoldingSchema = z.object({
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
  account: z.object({
    id: z.string(),
    name: z.string(),
    broker: z.string().nullable(),
    entityType: z.enum(["business", "personal"]),
  }),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-holdings",
  method: "get",
  tags: [...routeConfig.v1.holdingTags],
  summary: "List investment holdings",
  request: {
    query: z.object({
      accountId: z.string().optional(),
      assetClass: AssetClassValues.optional(),
      isActive: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(HoldingSchema), "Holdings retrieved"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const holdings = await listInvestmentHoldings(
      userId,
      {
        accountId: query.accountId,
        assetClass: query.assetClass,
        isActive: query.isActive === "true" ? true : query.isActive === "false" ? false : undefined,
      },
      prisma
    );

    return c.json(
      holdings.map((h) => ({
        id: h.id,
        accountId: h.accountId,
        assetClass: h.assetClass,
        subType: h.subType,
        ticker: h.ticker,
        name: h.name,
        currency: h.currency,
        currentQuantity: h.currentQuantity,
        averageCost: h.averageCost,
        totalInvested: h.totalInvested,
        isActive: h.isActive,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
        account: {
          id: h.account.id,
          name: h.account.name,
          broker: h.account.broker,
          entityType: h.account.entityType,
        },
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
