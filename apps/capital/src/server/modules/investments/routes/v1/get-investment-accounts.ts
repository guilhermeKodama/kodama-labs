import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listInvestmentAccounts } from "../../services/list-investment-accounts";
import { routeConfig } from "../../constants";

const InvestmentAccountSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  broker: z.string().nullable(),
  entityType: z.enum(["business", "personal"]),
  currency: z.string(),
  isActive: z.boolean(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  holdings: z.array(
    z.object({
      id: z.string(),
      assetClass: z.string(),
      totalInvested: z.number(),
    })
  ),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-accounts",
  method: "get",
  tags: [...routeConfig.v1.accountTags],
  summary: "List investment accounts",
  request: {
    query: z.object({
      entityType: z.enum(["business", "personal"]).optional(),
      isActive: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(InvestmentAccountSchema), "Investment accounts retrieved"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const query = c.req.valid("query");
    const accounts = await listInvestmentAccounts(
      userId,
      {
        entityType: query.entityType,
        isActive: query.isActive === "true" ? true : query.isActive === "false" ? false : undefined,
      },
      prisma
    );

    return c.json(
      accounts.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
        broker: a.broker,
        entityType: a.entityType,
        currency: a.currency,
        isActive: a.isActive,
        businessId: a.businessId,
        personalAccountId: a.personalAccountId,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        holdings: a.holdings.map((h) => ({
          id: h.id,
          assetClass: h.assetClass,
          totalInvested: h.totalInvested,
        })),
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
