import { createRoute } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { getFireSummary } from "../../services/get-fire-summary";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema, FireSummaryResponseSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/summary",
  method: "get",
  tags: [...routeConfig.v1.fireTags],
  summary: "Get FIRE summary",
  description:
    "Current FIRE state, the income-target vs. real-expenses gap, the prescribed plan, projection, scenarios, comparison tiers, coast status and history.",
  responses: {
    [OK]: jsonContent(FireSummaryResponseSchema, "FIRE summary"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const summary = await getFireSummary(userId, prisma);
    return c.json(summary, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
