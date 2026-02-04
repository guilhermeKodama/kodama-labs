import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { updateCategoryService } from "../../services/update-category";
import { routeConfig } from "../../constants";

const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
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
  path: "/v1/categories/{id}",
  method: "put",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Update category",
  description: "Updates an existing category",
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: jsonContent(UpdateCategorySchema, "Category update data"),
  },
  responses: {
    [OK]: jsonContent(CategorySchema, "Category updated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Category not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Cannot modify default categories"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const category = await updateCategoryService(id, body, prisma);

    return c.json(
      {
        id: category.id,
        userId: category.userId,
        name: category.name,
        type: category.type,
        color: category.color,
        icon: category.icon,
        isDefault: category.isDefault,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Category not found") {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    if (message.includes("default")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
