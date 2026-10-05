import { createRoute } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { recordCurrentSnapshot } from "../../services/record-current-snapshot";
import { routeConfig } from "../../constants";
import { FireSnapshotSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshot",
  method: "post",
  tags: [...routeConfig.v1.fireTags],
  summary: "Record this month's FIRE snapshot",
  description: "Force-refreshes the current month's progress snapshot.",
  responses: {
    [OK]: jsonContent(FireSnapshotSchema, "Snapshot recorded"),
    [BAD_REQUEST]: jsonContent(ApiErrorSchema, "No FIRE plan to snapshot"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const snapshot = await recordCurrentSnapshot(userId, prisma);
  if (!snapshot) {
    throw new LedgerError("No FIRE plan to snapshot", 400, { code: "fire.no_plan" });
  }
  return c.json(snapshot, OK);
};
