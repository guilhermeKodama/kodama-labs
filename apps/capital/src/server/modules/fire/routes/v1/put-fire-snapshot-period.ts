import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { upsertManualSnapshot } from "../../services/manage-snapshots";
import { serializeSnapshot } from "../../services/serialize";
import { routeConfig } from "../../constants";
import { FireSnapshotSchema, SnapshotUpsertSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshots/{period}",
  method: "put",
  tags: [...routeConfig.v1.fireTags],
  summary: "Create or edit a month's snapshot (manual / backfill)",
  request: {
    params: z.object({ period: z.coerce.number().int().min(190001).max(999912) }),
    body: jsonContent(SnapshotUpsertSchema, "Snapshot data"),
  },
  responses: {
    [OK]: jsonContent(FireSnapshotSchema, "Snapshot saved"),
    [BAD_REQUEST]: jsonContent(ApiErrorSchema, "No FIRE plan"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const { period } = c.req.valid("param");
  const body = c.req.valid("json");
  const snapshot = await upsertManualSnapshot(userId, period, body, prisma);
  if (!snapshot) {
    throw new LedgerError("No FIRE plan", 400, { code: "fire.no_plan" });
  }
  return c.json(serializeSnapshot(snapshot), OK);
};
