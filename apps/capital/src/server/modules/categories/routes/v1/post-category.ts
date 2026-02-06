import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { createCategory } from "../../services/create-category";
import { routeConfig } from "../../constants";

const CreateCategorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense", "investment"]),
  color: z.string().optional(),
  icon: z.string().optional(),
});

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
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Create category",
  description: "Creates a new category for the authenticated user",
  request: {
    body: jsonContent(CreateCategorySchema, "Category creation data"),
  },
  responses: {
    [CREATED]: jsonContent(CategorySchema, "Category created"),
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
    const category = await createCategory({ ...body, userId }, prisma);

    return c.json(
      {
        id: category.id,
        userId: category.userId,
        name: category.name,
        type: category.type,
        color: category.color,
        icon: category.icon,
        isDefault: category.isDefault,
        isSystem: category.isSystem,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
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
