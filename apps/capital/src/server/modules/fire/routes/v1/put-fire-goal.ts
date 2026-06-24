import { createRoute } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { upsertFireGoal } from "../../services/upsert-fire-goal";
import { serializeGoal } from "../../services/serialize";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema, FireGoalInputSchema, FireGoalSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/goal",
  method: "put",
  tags: [...routeConfig.v1.fireTags],
  summary: "Create or update the FIRE plan",
  description: "Upserts the authenticated user's single FIRE plan.",
  request: {
    body: jsonContent(FireGoalInputSchema, "FIRE plan data"),
  },
  responses: {
    [OK]: jsonContent(FireGoalSchema, "FIRE plan saved"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const goal = await upsertFireGoal(userId, body, prisma);
    return c.json(serializeGoal(goal), OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
