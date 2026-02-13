import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate, toDateString } from "@capital/server/lib/date-utils";
import { createTransfer } from "../../services/create-transfer";
import { routeConfig } from "../../constants";

const CreateTransferSchema = z.object({
  fromEntityType: z.enum(["business", "personal"]),
  toEntityType: z.enum(["business", "personal"]),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement", "investment_deposit", "investment_withdrawal"]),
  amount: z.number().positive(),
  currency: z.string().length(3),
  exchangeRate: z.number().positive().optional(),
  description: z.string().optional(),
  date: z.string(),
  fromBusinessId: z.string().optional(),
  fromPersonalAccountId: z.string().optional(),
  toBusinessId: z.string().optional(),
  toPersonalAccountId: z.string().optional(),
  toInvestmentAccountId: z.string().optional(),
  fromInvestmentAccountId: z.string().optional(),
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
  path: "/v1/transfers",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create transfer",
  description: "Creates a new transfer between entities for the authenticated user",
  request: {
    body: jsonContent(CreateTransferSchema, "Transfer creation data"),
  },
  responses: {
    [CREATED]: jsonContent(TransferSchema, "Transfer created"),
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
    const body = c.req.valid("json");
    const transfer = await createTransfer(
      userId,
      {
        ...body,
        date: parseLocalDate(body.date),
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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
