import { createRoute, z } from "@hono/zod-openapi";
import { OK, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { listTransfers } from "../../services/list-transfers";
import { routeConfig } from "../../constants";

const TransferSchema = z.object({
  id: z.string(),
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string().nullable(),
  date: z.string(),
  fromBusinessId: z.string().nullable(),
  fromPersonalAccountId: z.string().nullable(),
  toBusinessId: z.string().nullable(),
  toPersonalAccountId: z.string().nullable(),
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
  path: "/v1/transfers",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List transfers",
  description: "Lists transfers with optional filters",
  request: {
    query: z.object({
      fromBusinessId: z.string().optional(),
      fromPersonalAccountId: z.string().optional(),
      toBusinessId: z.string().optional(),
      toPersonalAccountId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(TransferSchema), "Transfers retrieved"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const query = c.req.valid("query");
    const transfers = await listTransfers(
      {
        ...query,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      },
      prisma
    );

    return c.json(
      transfers.map((t) => ({
        id: t.id,
        fromEntityType: t.fromEntityType,
        toEntityType: t.toEntityType,
        direction: t.direction,
        amount: t.amount,
        currency: t.currency,
        exchangeRate: t.exchangeRate,
        description: t.description,
        date: t.date.toISOString(),
        fromBusinessId: t.fromBusinessId,
        fromPersonalAccountId: t.fromPersonalAccountId,
        toBusinessId: t.toBusinessId,
        toPersonalAccountId: t.toPersonalAccountId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
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
