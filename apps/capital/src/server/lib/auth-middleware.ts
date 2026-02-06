import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";

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
    throw new HTTPException(401, {
      message: "Authentication required",
    });
  }

  const session = await validateSession(sessionId, prisma);

  if (!session) {
    throw new HTTPException(401, {
      message: "Session expired or invalid",
    });
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
    throw new HTTPException(401, {
      message: "Authentication required",
    });
  }

  return userId;
}

/**
 * Custom error class for authorization failures (user doesn't own the resource).
 */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to access this resource") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Verify that the authenticated user owns the resource.
 * Throws ForbiddenError if ownership check fails.
 */
export function requireOwnership(
  authenticatedUserId: string,
  resourceUserId: string,
  resourceName = "resource"
): void {
  if (authenticatedUserId !== resourceUserId) {
    throw new ForbiddenError(
      `You do not have permission to access this ${resourceName}`
    );
  }
}
