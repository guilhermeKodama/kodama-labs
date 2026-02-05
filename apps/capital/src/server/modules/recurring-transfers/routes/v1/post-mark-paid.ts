import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR, BAD_REQUEST } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { markRecurringTransferAsPaid } from "../../services/mark-paid";
import { routeConfig } from "../../constants";

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

const TransferSchema = z.object({
  id: z.string(),
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string().nullable(),
  date: z.string(),
  fromBusinessId: z.string().nullable(),
  fromPersonalAccountId: z.string().nullable(),
  toBusinessId: z.string().nullable(),
  toPersonalAccountId: z.string().nullable(),
  recurringTransferId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MarkPaidResponseSchema = z.object({
  createdTransfer: TransferSchema,
  updatedRecurring: RecurringTransferSchema,
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/recurring-transfers/{id}/mark-paid",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Mark recurring transfer as paid",
  description:
    "Creates a transfer for the current due date and advances the recurring transfer to the next occurrence",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(MarkPaidResponseSchema, "Recurring transfer marked as paid"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Recurring transfer not found"),
    [BAD_REQUEST]: jsonContent(
      ErrorResponseSchema,
      "Bad request (e.g., cannot mark paused transfer)"
    ),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    const result = await markRecurringTransferAsPaid(id);

    return c.json(
      {
        createdTransfer: {
          id: result.createdTransfer.id,
          fromEntityType: result.createdTransfer.fromEntityType,
          toEntityType: result.createdTransfer.toEntityType,
          direction: result.createdTransfer.direction,
          amount: result.createdTransfer.amount,
          currency: result.createdTransfer.currency,
          exchangeRate: result.createdTransfer.exchangeRate,
          description: result.createdTransfer.description,
          date: result.createdTransfer.date.toISOString(),
          fromBusinessId: result.createdTransfer.fromBusinessId,
          fromPersonalAccountId: result.createdTransfer.fromPersonalAccountId,
          toBusinessId: result.createdTransfer.toBusinessId,
          toPersonalAccountId: result.createdTransfer.toPersonalAccountId,
          recurringTransferId: result.createdTransfer.recurringTransferId,
          createdAt: result.createdTransfer.createdAt.toISOString(),
          updatedAt: result.createdTransfer.updatedAt.toISOString(),
        },
        updatedRecurring: {
          id: result.updatedRecurring.id,
          fromEntityType: result.updatedRecurring.fromEntityType,
          toEntityType: result.updatedRecurring.toEntityType,
          direction: result.updatedRecurring.direction,
          amount: result.updatedRecurring.amount,
          currency: result.updatedRecurring.currency,
          exchangeRate: result.updatedRecurring.exchangeRate,
          description: result.updatedRecurring.description,
          frequency: result.updatedRecurring.frequency,
          startDate: result.updatedRecurring.startDate.toISOString(),
          endDate: result.updatedRecurring.endDate?.toISOString() ?? null,
          nextDueDate: result.updatedRecurring.nextDueDate.toISOString(),
          lastGeneratedDate:
            result.updatedRecurring.lastGeneratedDate?.toISOString() ?? null,
          isActive: result.updatedRecurring.isActive,
          fromBusinessId: result.updatedRecurring.fromBusinessId,
          fromPersonalAccountId: result.updatedRecurring.fromPersonalAccountId,
          toBusinessId: result.updatedRecurring.toBusinessId,
          toPersonalAccountId: result.updatedRecurring.toPersonalAccountId,
          createdAt: result.updatedRecurring.createdAt.toISOString(),
          updatedAt: result.updatedRecurring.updatedAt.toISOString(),
        },
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    if (message.includes("paused")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
