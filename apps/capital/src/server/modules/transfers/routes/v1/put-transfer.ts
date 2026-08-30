import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { updateTransferService } from "../../services/update-transfer";
import { routeConfig } from "../../constants";

const UpdateTransferSchema = z.object({
  fromEntityType: z.enum(["business", "personal"]).optional(),
  toEntityType: z.enum(["business", "personal"]).optional(),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement", "investment_deposit", "investment_withdrawal"]).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  description: z.string().nullable().optional(),
  date: z.string().optional(),
  fromBusinessId: z.string().nullable().optional(),
  fromPersonalAccountId: z.string().nullable().optional(),
  toBusinessId: z.string().nullable().optional(),
  toPersonalAccountId: z.string().nullable().optional(),
  toInvestmentAccountId: z.string().nullable().optional(),
  fromInvestmentAccountId: z.string().nullable().optional(),
});

const TransferSchema = z.object({
  id: z.string(),
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement", "investment_deposit", "investment_withdrawal"]),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  description: z.string().nullable(),
  date: z.string(),
  fromBusinessId: z.string().nullable(),
  fromPersonalAccountId: z.string().nullable(),
  toBusinessId: z.string().nullable(),
  toPersonalAccountId: z.string().nullable(),
  toInvestmentAccountId: z.string().nullable(),
  fromInvestmentAccountId: z.string().nullable(),
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
  path: "/v1/transfers/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update transfer",
  description: "Updates an existing transfer for the authenticated user",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateTransferSchema, "Transfer update data"),
  },
  responses: {
    [OK]: jsonContent(TransferSchema, "Transfer updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Transfer not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
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
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updateData: Parameters<typeof updateTransferService>[2] = {
      ...body,
      date: body.date ? parseLocalDate(body.date) : undefined,
    };

    const transfer = await updateTransferService(userId, id, updateData, prisma);

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
        date: toDateString(transfer.date),
        fromBusinessId: transfer.fromBusinessId,
        fromPersonalAccountId: transfer.fromPersonalAccountId,
        toBusinessId: transfer.toBusinessId,
        toPersonalAccountId: transfer.toPersonalAccountId,
        toInvestmentAccountId: transfer.toInvestmentAccountId,
        fromInvestmentAccountId: transfer.fromInvestmentAccountId,
        createdAt: transfer.createdAt.toISOString(),
        updatedAt: transfer.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transfer not found" || message.includes("Record to update not found")) {
      return c.json({ error: { code: "NOT_FOUND", message: "Transfer not found" } }, NOT_FOUND);
    }
    if (message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
