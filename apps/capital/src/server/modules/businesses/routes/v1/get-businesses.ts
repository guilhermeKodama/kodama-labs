import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listBusinesses } from "../../services/list-businesses";
import { routeConfig } from "../../constants";

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
  path: "/v1/businesses",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List businesses",
  description: "Lists all businesses for the authenticated user",
  responses: {
    [OK]: jsonContent(z.array(BusinessSchema), "Businesses retrieved"),
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
    const businesses = await listBusinesses(userId, prisma);

    return c.json(
      businesses.map((b) => ({
        id: b.id,
        userId: b.userId,
        name: b.name,
        description: b.description,
        defaultCurrency: b.defaultCurrency,
        color: b.color,
        taxRate: b.taxRate,
        initialBalance: b.initialBalance,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
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
