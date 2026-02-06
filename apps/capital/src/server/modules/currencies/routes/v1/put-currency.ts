import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateCurrencyRateService } from "../../services/update-currency";
import { routeConfig } from "../../constants";

const UpdateCurrencySchema = z.object({
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
  path: "/v1/currencies/{code}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update currency rate",
  description: "Updates the manual exchange rate for a currency for the authenticated user",
  request: {
    params: z.object({
      code: z.string(),
    }),
    body: jsonContent(UpdateCurrencySchema, "Currency rate update"),
  },
  responses: {
    [OK]: jsonContent(CurrencySchema, "Currency updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Currency not found"),
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
    const { code } = c.req.valid("param");
    const { manualRate } = c.req.valid("json");
    const currency = await updateCurrencyRateService(
      userId,
      code,
      manualRate,
      prisma
    );

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
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Currency not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
