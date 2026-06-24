import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { deleteSnapshot } from "../../services/manage-snapshots";
import { routeConfig } from "../../constants";
import { ErrorResponseSchema } from "../../validations/fire";

export const route = createRoute({
  path: "/v1/fire/snapshots/{period}",
  method: "delete",
  tags: [...routeConfig.v1.fireTags],
  summary: "Delete a month's snapshot",
  request: {
    params: z.object({ period: z.coerce.number().int().min(190001).max(999912) }),
  },
  responses: {
    [OK]: jsonContent(z.object({ success: z.boolean() }), "Snapshot deleted"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { period } = c.req.valid("param");
    const success = await deleteSnapshot(userId, period, prisma);
    return c.json({ success }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
