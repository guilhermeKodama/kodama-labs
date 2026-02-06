import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listCategories } from "../../services/list-categories";
import { routeConfig } from "../../constants";

const CategorySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  type: z.enum(["income", "expense", "investment"]),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
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
  path: "/v1/categories",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List categories",
  description: "Lists categories for the authenticated user",
  request: {
    query: z.object({
      type: z.enum(["income", "expense", "investment"]).optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(CategorySchema), "Categories retrieved"),
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
    const { type } = c.req.valid("query");
    const categories = await listCategories(userId, type, prisma);

    return c.json(
      categories.map((cat) => ({
        id: cat.id,
        userId: cat.userId,
        name: cat.name,
        type: cat.type,
        color: cat.color,
        icon: cat.icon,
        isDefault: cat.isDefault,
        isSystem: cat.isSystem,
        createdAt: cat.createdAt.toISOString(),
        updatedAt: cat.updatedAt.toISOString(),
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
