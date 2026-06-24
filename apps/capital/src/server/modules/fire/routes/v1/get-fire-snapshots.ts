import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listFireSnapshots } from "../../services/list-fire-snapshots";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema, FireSnapshotSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshots",
  method: "get",
  tags: [...routeConfig.v1.fireTags],
  summary: "List FIRE progress snapshots",
  responses: {
    [OK]: jsonContent(z.array(FireSnapshotSchema), "FIRE snapshots"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const snapshots = await listFireSnapshots(userId, prisma);
    return c.json(snapshots, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
