import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { toDateString } from "@capital/server/lib/date-utils";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { listRecurringTransfers } from "../../services/list-recurring-transfers";
import { routeConfig } from "../../constants";

const RecurringTransferSchema = z.object({
  id: z.string(),
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement", "investment_deposit", "investment_withdrawal"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
  nextDueDate: z.string(),
  lastGeneratedDate: z.string().nullable(),
  isActive: z.boolean(),
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
  path: "/v1/recurring-transfers",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List recurring transfers",
  description: "Lists recurring transfers with optional filters",
  request: {
    query: z.object({
      fromBusinessId: z.string().optional(),
      fromPersonalAccountId: z.string().optional(),
      toBusinessId: z.string().optional(),
      toPersonalAccountId: z.string().optional(),
      fromEntityType: z.enum(["business", "personal"]).optional(),
      toEntityType: z.enum(["business", "personal"]).optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(RecurringTransferSchema), "Recurring transfers"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Unauthorized"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = c.get("userId");
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "User not authenticated" } },
        UNAUTHORIZED
      );
    }

    const query = c.req.valid("query");
    const transfers = await listRecurringTransfers(userId, query, prisma);

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
        frequency: t.frequency,
        startDate: toDateString(t.startDate),
        endDate: t.endDate?.toISOString() ?? null,
        nextDueDate: toDateString(t.nextDueDate),
        lastGeneratedDate: t.lastGeneratedDate?.toISOString() ?? null,
        isActive: t.isActive,
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
