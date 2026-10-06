import { createRoute } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, UNPROCESSABLE_ENTITY, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { upsertFireGoal } from "../../services/upsert-fire-goal";
import { serializeGoal } from "../../services/serialize";
import { routeConfig } from "../../constants";
import { FireGoalPatchSchema, FireGoalSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/goal",
  method: "put",
  tags: [...routeConfig.v1.fireTags],
  summary: "Create or update the FIRE plan",
  description:
    "Upserts the authenticated user's single FIRE plan. The body may carry any subset of the plan: fields left out keep their stored value (an explicit null clears a nullable one). Creating the plan needs targetMonthlyIncome, safeWithdrawalRate, nominalAnnualReturn, annualInflation, planningMode, phaseProfile and phases (422 fire.goal_incomplete).",
  request: {
    body: jsonContent(FireGoalPatchSchema, "FIRE plan fields to change"),
  },
  responses: {
    [OK]: jsonContent(FireGoalSchema, "FIRE plan saved"),
    [UNPROCESSABLE_ENTITY]: jsonContent(ApiErrorSchema, "Invalid request data, or a new plan missing required fields"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const goal = await upsertFireGoal(userId, body, prisma);
  return c.json(serializeGoal(goal), OK);
};
