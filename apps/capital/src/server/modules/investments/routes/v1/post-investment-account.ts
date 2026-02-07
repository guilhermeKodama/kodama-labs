import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createInvestmentAccount } from "../../services/create-investment-account";
import { routeConfig } from "../../constants";

const CreateSchema = z.object({
  name: z.string().min(1),
  broker: z.string().optional(),
  entityType: z.enum(["business", "personal"]),
  currency: z.string().length(3),
  businessId: z.string().optional(),
  personalAccountId: z.string().optional(),
});

const ResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  broker: z.string().nullable(),
  entityType: z.enum(["business", "personal"]),
  currency: z.string(),
  isActive: z.boolean(),
  businessId: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-accounts",
  method: "post",
  tags: [...routeConfig.v1.accountTags],
  summary: "Create investment account",
  request: {
    body: jsonContent(CreateSchema, "Investment account data"),
  },
  responses: {
    [CREATED]: jsonContent(ResponseSchema, "Investment account created"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid input"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const account = await createInvestmentAccount(userId, body, prisma);

    return c.json(
      {
        id: account.id,
        userId: account.userId,
        name: account.name,
        broker: account.broker,
        entityType: account.entityType,
        currency: account.currency,
        isActive: account.isActive,
        businessId: account.businessId,
        personalAccountId: account.personalAccountId,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("required") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
