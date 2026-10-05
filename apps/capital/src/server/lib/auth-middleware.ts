import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";

import { HttpError } from "./http-error";
import { prisma } from "./prisma";
import { validateSession } from "../modules/auth/services/session";
import type { AppBindings } from "../types";

const SESSION_COOKIE_NAME = "capital_session";

/**
 * Authentication middleware that validates session cookie and sets userId in context.
 * Use this middleware on all protected routes.
 */
export const authMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionId) {
    throw new HttpError(401, "Authentication required", { code: "auth.required" });
  }

  const session = await validateSession(sessionId, prisma);

  if (!session) {
    throw new HttpError(401, "Session expired or invalid", { code: "auth.session_invalid" });
  }

  // Set userId in context for use by route handlers
  c.set("userId", session.userId);

  await next();
};

/**
 * Get the authenticated userId from context.
 * Throws 401 if user is not authenticated.
 * Use this in route handlers after authMiddleware has been applied.
 */
export function requireUserId(c: Context<AppBindings>): string {
  const userId = c.get("userId");

  if (!userId) {
    throw new HttpError(401, "Authentication required", { code: "auth.required" });
  }

  return userId;
}
