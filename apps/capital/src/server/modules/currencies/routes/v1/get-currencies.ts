import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listCurrencies } from "../../services/list-currencies";
import { routeConfig } from "../../constants";

const CurrencySchema = z.object({
  id: z.string(),
  userId: z.string(),
  code: z.string(),
  name: z.string(),
  symbol: z.string(),
  manualRate: z.number(),
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
  path: "/v1/currencies",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List currencies",
  description: "Lists currencies for the authenticated user",
  responses: {
    [OK]: jsonContent(z.array(CurrencySchema), "Currencies retrieved"),
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
    const currencies = await listCurrencies(userId, prisma);

    return c.json(
      currencies.map((cur) => ({
        id: cur.id,
        userId: cur.userId,
        code: cur.code,
        name: cur.name,
        symbol: cur.symbol,
        manualRate: cur.manualRate,
        createdAt: cur.createdAt.toISOString(),
        updatedAt: cur.updatedAt.toISOString(),
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
