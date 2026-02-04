import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { createBusiness } from "../../services/create-business";
import { routeConfig } from "../../constants";

const CreateBusinessSchema = z.object({
  userId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultCurrency: z.string().length(3),
  color: z.string().optional(),
});

const BusinessSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultCurrency: z.string(),
  color: z.string().nullable(),
  taxRate: z.number(),
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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create business",
  description: "Creates a new business entity",
  request: {
    body: jsonContent(CreateBusinessSchema, "Business creation data"),
  },
  responses: {
    [CREATED]: jsonContent(BusinessSchema, "Business created successfully"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const body = c.req.valid("json");
    const business = await createBusiness(body, prisma);

    return c.json(
      {
        id: business.id,
        userId: business.userId,
        name: business.name,
        description: business.description,
        defaultCurrency: business.defaultCurrency,
        color: business.color,
        taxRate: business.taxRate,
        createdAt: business.createdAt.toISOString(),
        updatedAt: business.updatedAt.toISOString(),
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
