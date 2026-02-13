import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import {
  fundInvestmentAccount,
  withdrawInvestmentAccount,
} from "../../services/fund-investment-account";
import { routeConfig } from "../../constants";

const FundWithdrawSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
  exchangeRate: z.number().optional(),
  description: z.string().optional(),
  date: z.string(),
});

const ResponseSchema = z.object({
  cashBalance: z.number(),
  linkedTransactionId: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ---- FUND route ----

export const fundRoute = createRoute({
  path: "/v1/investment-accounts/{id}/fund",
  method: "post",
  tags: [...routeConfig.v1.accountTags],
  summary: "Fund investment account (transfer from entity checking account)",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(FundWithdrawSchema, "Fund data"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Account funded"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid input"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const fundHandler: AppRouteHandler<typeof fundRoute> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await fundInvestmentAccount(
      userId,
      {
        accountId: id,
        amount: body.amount,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        description: body.description,
        date: parseLocalDate(body.date),
      },
      prisma
    );

    return c.json(
      {
        cashBalance: result.account.cashBalance,
        linkedTransactionId: result.linkedTransaction.id,
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("access denied") || message.includes("not found")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};

// ---- WITHDRAW route ----

export const withdrawRoute = createRoute({
  path: "/v1/investment-accounts/{id}/withdraw",
  method: "post",
  tags: [...routeConfig.v1.accountTags],
  summary: "Withdraw from investment account (transfer to entity checking account)",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(FundWithdrawSchema, "Withdraw data"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Withdrawal completed"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid input"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const withdrawHandler: AppRouteHandler<typeof withdrawRoute> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await withdrawInvestmentAccount(
      userId,
      {
        accountId: id,
        amount: body.amount,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        description: body.description,
        date: parseLocalDate(body.date),
      },
      prisma
    );

    return c.json(
      {
        cashBalance: result.account.cashBalance,
        linkedTransactionId: result.linkedTransaction.id,
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("access denied") ||
      message.includes("not found") ||
      message.includes("Insufficient")
    ) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
