import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { upsertManualSnapshot } from "../../services/manage-snapshots";
import { serializeSnapshot } from "../../services/serialize";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema, FireSnapshotSchema, SnapshotUpsertSchema } from "../../validations/fire";

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
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "No FIRE plan"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { period } = c.req.valid("param");
    const body = c.req.valid("json");
    const snapshot = await upsertManualSnapshot(userId, period, body, prisma);
    if (!snapshot) {
      return c.json({ error: { code: "BAD_REQUEST", message: "No FIRE plan" } }, BAD_REQUEST);
    }
    return c.json(serializeSnapshot(snapshot), OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
