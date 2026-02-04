import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { createCurrency } from "../../services/create-currency";
import { routeConfig } from "../../constants";

const CreateCurrencySchema = z.object({
  userId: z.string(),
  code: z.string().length(3).toUpperCase(),
  name: z.string().min(1),
  symbol: z.string().min(1),
  manualRate: z.number().positive(),
});

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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create or update currency",
  description: "Creates a new currency or updates existing one",
  request: {
    body: jsonContent(CreateCurrencySchema, "Currency data"),
  },
  responses: {
    [CREATED]: jsonContent(CurrencySchema, "Currency created/updated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const body = c.req.valid("json");
    const currency = await createCurrency(body, prisma);

    return c.json(
      {
        id: currency.id,
        userId: currency.userId,
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        manualRate: currency.manualRate,
        createdAt: currency.createdAt.toISOString(),
        updatedAt: currency.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
