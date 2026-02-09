import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { getUserById } from "../../services/get-user";
import { routeConfig } from "../../constants";

const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  baseCurrency: z.string(),
  theme: z.string(),
  dateFormat: z.string(),
  numberFormat: z.string(),
  timezone: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  personalAccount: z
    .object({
      id: z.string(),
      defaultCurrency: z.string(),
    })
    .nullable(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/users/me",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get current user",
  description: "Retrieves the currently authenticated user",
  responses: {
    [OK]: jsonContent(UserResponseSchema, "User retrieved successfully"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Unauthorized"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "User not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = c.get("userId");
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "User not authenticated" } },
        UNAUTHORIZED
      );
    }

    const user = await getUserById(userId, prisma);

    return c.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        baseCurrency: user.baseCurrency,
        theme: user.theme,
        dateFormat: user.dateFormat,
        numberFormat: user.numberFormat,
        timezone: user.timezone,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        personalAccount: user.personalAccount
          ? {
              id: user.personalAccount.id,
              defaultCurrency: user.personalAccount.defaultCurrency,
            }
          : null,
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "User not found") {
      return c.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        NOT_FOUND
      );
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
