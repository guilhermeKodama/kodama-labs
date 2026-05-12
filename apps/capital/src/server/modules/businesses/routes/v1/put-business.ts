import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { updateBusinessService } from "../../services/update-business";
import { routeConfig } from "../../constants";

const UpdateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
  color: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  initialBalance: z.number().optional(),
});

const BusinessSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultCurrency: z.string(),
  color: z.string().nullable(),
  taxRate: z.number(),
  initialBalance: z.number(),
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
  path: "/v1/businesses/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update business",
  description: "Updates an existing business entity for the authenticated user",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateBusinessSchema, "Business update data"),
  },
  responses: {
    [OK]: jsonContent(BusinessSchema, "Business updated successfully"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Business not found"),
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
    const business = await updateBusinessService(userId, id, body, prisma);

    return c.json(
      {
        id: business.id,
        userId: business.userId,
        name: business.name,
        description: business.description,
        defaultCurrency: business.defaultCurrency,
        color: business.color,
        taxRate: business.taxRate,
        initialBalance: business.initialBalance,
        createdAt: business.createdAt.toISOString(),
        updatedAt: business.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Business not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
