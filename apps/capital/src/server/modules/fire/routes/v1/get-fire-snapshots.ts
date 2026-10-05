import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { listFireSnapshots } from "../../services/list-fire-snapshots";
import { routeConfig } from "../../constants";
import { FireSnapshotSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshots",
  method: "get",
  tags: [...routeConfig.v1.fireTags],
  summary: "List FIRE progress snapshots",
  responses: {
    [OK]: jsonContent(z.array(FireSnapshotSchema), "FIRE snapshots"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const snapshots = await listFireSnapshots(userId, prisma);
  return c.json(snapshots, OK);
};
