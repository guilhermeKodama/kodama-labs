import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { createRecurringTransfer } from "../../services/create-recurring-transfer";
import { routeConfig } from "../../constants";

const CreateRecurringTransferSchema = z.object({
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]),
  amount: z.number().positive(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string(),
  endDate: z.string().optional(),
  fromBusinessId: z.string().optional(),
  fromPersonalAccountId: z.string().optional(),
  toBusinessId: z.string().optional(),
  toPersonalAccountId: z.string().optional(),
});

const RecurringTransferSchema = z.object({
  id: z.string(),
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]),
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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create recurring transfer",
  description: "Creates a new recurring transfer",
  request: {
    body: jsonContent(CreateRecurringTransferSchema, "Recurring transfer data"),
  },
  responses: {
    [CREATED]: jsonContent(RecurringTransferSchema, "Recurring transfer created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
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

    const body = c.req.valid("json");
    const transfer = await createRecurringTransfer(
      userId,
      {
        ...body,
        startDate: parseLocalDate(body.startDate),
        endDate: body.endDate ? parseLocalDate(body.endDate) : undefined,
      },
      prisma
    );

    return c.json(
      {
        id: transfer.id,
        fromEntityType: transfer.fromEntityType,
        toEntityType: transfer.toEntityType,
        direction: transfer.direction,
        amount: transfer.amount,
        currency: transfer.currency,
        exchangeRate: transfer.exchangeRate,
        description: transfer.description,
        frequency: transfer.frequency,
        startDate: toDateString(transfer.startDate),
        endDate: transfer.endDate?.toISOString() ?? null,
        nextDueDate: toDateString(transfer.nextDueDate),
        lastGeneratedDate: transfer.lastGeneratedDate?.toISOString() ?? null,
        isActive: transfer.isActive,
        fromBusinessId: transfer.fromBusinessId,
        fromPersonalAccountId: transfer.fromPersonalAccountId,
        toBusinessId: transfer.toBusinessId,
        toPersonalAccountId: transfer.toPersonalAccountId,
        createdAt: transfer.createdAt.toISOString(),
        updatedAt: transfer.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required") || message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
