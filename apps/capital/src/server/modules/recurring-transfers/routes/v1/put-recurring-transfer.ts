import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { updateRecurringTransfer } from "../../data/commands/update-recurring-transfer";
import { routeConfig } from "../../constants";

const UpdateRecurringTransferSchema = z.object({
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
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
  path: "/v1/recurring-transfers/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update recurring transfer",
  description: "Updates an existing recurring transfer",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateRecurringTransferSchema, "Recurring transfer update data"),
  },
  responses: {
    [OK]: jsonContent(RecurringTransferSchema, "Recurring transfer updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Recurring transfer not found"),
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

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updateData: Parameters<typeof updateRecurringTransfer>[2] = {
      ...body,
      startDate: body.startDate ? parseLocalDate(body.startDate) : undefined,
      endDate: body.endDate === null ? null : body.endDate ? parseLocalDate(body.endDate) : undefined,
    };

    // If startDate is updated, also update nextDueDate
    if (updateData.startDate) {
      updateData.nextDueDate = updateData.startDate;
    }

    const transfer = await updateRecurringTransfer(userId, id, updateData, prisma);

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
        startDate: transfer.startDate.toISOString(),
        endDate: transfer.endDate?.toISOString() ?? null,
        nextDueDate: transfer.nextDueDate.toISOString(),
        lastGeneratedDate: transfer.lastGeneratedDate?.toISOString() ?? null,
        isActive: transfer.isActive,
        fromBusinessId: transfer.fromBusinessId,
        fromPersonalAccountId: transfer.fromPersonalAccountId,
        toBusinessId: transfer.toBusinessId,
        toPersonalAccountId: transfer.toPersonalAccountId,
        createdAt: transfer.createdAt.toISOString(),
        updatedAt: transfer.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("Record to update not found")) {
      return c.json({ error: { code: "NOT_FOUND", message: "Recurring transfer not found" } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
