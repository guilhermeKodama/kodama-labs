import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateInvestmentAccountService } from "../../services/update-investment-account";
import { routeConfig } from "../../constants";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  broker: z.string().optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
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
  path: "/v1/investment-accounts/{id}",
  method: "put",
  tags: [...routeConfig.v1.accountTags],
  summary: "Update investment account",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContent(UpdateSchema, "Investment account update data"),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "Investment account updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const account = await updateInvestmentAccountService(userId, id, body, prisma);

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
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
