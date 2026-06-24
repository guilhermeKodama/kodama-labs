import { createRoute } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { recordCurrentSnapshot } from "../../services/record-current-snapshot";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema, FireSnapshotSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshot",
  method: "post",
  tags: [...routeConfig.v1.fireTags],
  summary: "Record this month's FIRE snapshot",
  description: "Force-refreshes the current month's progress snapshot.",
  responses: {
    [OK]: jsonContent(FireSnapshotSchema, "Snapshot recorded"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "No FIRE plan to snapshot"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const snapshot = await recordCurrentSnapshot(userId, prisma);
    if (!snapshot) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "No FIRE plan to snapshot" } },
        BAD_REQUEST
      );
    }
    return c.json(snapshot, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
