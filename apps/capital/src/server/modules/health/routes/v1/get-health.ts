import { createRoute, z } from "@hono/zod-openapi";
import { OK } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";

const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  version: z.string(),
});

export const route = createRoute({
  path: "/v1/health",
  method: "get",
  tags: ["Health"],
  summary: "Health check",
  description: "Returns the health status of the API",
  responses: {
    [OK]: jsonContent(HealthResponseSchema, "API is healthy"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  return c.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    },
    OK
  );
};
