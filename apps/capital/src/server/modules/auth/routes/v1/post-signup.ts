import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { setCookie } from "hono/cookie";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { signup } from "../../services/signup";
import { createSession } from "../../services/session";
import { routeConfig, SESSION_COOKIE_NAME } from "../../constants";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  baseCurrency: z.string().length(3).optional(),
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
  path: "/v1/auth/signup",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Sign up a new user",
  description: "Creates a new user account with email and password",
  request: {
    body: jsonContent(SignupSchema, "Signup data"),
  },
  responses: {
    [CREATED]: jsonContent(UserResponseSchema, "User created successfully"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const body = c.req.valid("json");
    const user = await signup(body, prisma);

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
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("already exists")) {
      return c.json(
        { error: { code: "BAD_REQUEST", message } },
        BAD_REQUEST
      );
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
