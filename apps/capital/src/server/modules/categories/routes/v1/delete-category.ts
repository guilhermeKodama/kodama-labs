import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { deleteCategoryService } from "../../services/delete-category";
import { routeConfig } from "../../constants";

const SuccessResponseSchema = z.object({
  message: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/categories/{id}",
  method: "delete",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Delete category",
  description: "Deletes a category",
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(SuccessResponseSchema, "Category deleted"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Category not found"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Cannot delete default categories"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const { id } = c.req.valid("param");
    await deleteCategoryService(id, prisma);

    return c.json({ message: "Category deleted successfully" }, OK);
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
