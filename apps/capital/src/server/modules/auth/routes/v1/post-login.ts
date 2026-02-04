import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { setCookie } from "hono/cookie";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { login } from "../../services/login";
import { createSession } from "../../services/session";
import { routeConfig, SESSION_COOKIE_NAME } from "../../constants";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  baseCurrency: z.string(),
  theme: z.string(),
  dateFormat: z.string(),
  numberFormat: z.string(),
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
  path: "/v1/auth/login",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Log in a user",
  description: "Authenticates a user with email and password",
  request: {
    body: jsonContent(LoginSchema, "Login credentials"),
  },
  responses: {
    [OK]: jsonContent(UserResponseSchema, "Login successful"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Invalid credentials"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const body = c.req.valid("json");
    const user = await login(body, prisma);

    // Create session
    const sessionId = await createSession(user.id, prisma);

    // Set session cookie
    setCookie(c, SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return c.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        baseCurrency: user.baseCurrency,
        theme: user.theme,
        dateFormat: user.dateFormat,
        numberFormat: user.numberFormat,
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
    if (message.includes("Invalid email or password")) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message } },
        UNAUTHORIZED
      );
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
