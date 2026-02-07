import { createRoute, z } from "@hono/zod-openapi";
import { OK, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { deleteInvestmentHoldingService } from "../../services/delete-investment-holding";
import { routeConfig } from "../../constants";

const SuccessSchema = z.object({ message: z.string() });
const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/investment-holdings/{id}",
  method: "delete",
  tags: [...routeConfig.v1.holdingTags],
  summary: "Delete investment holding",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    [OK]: jsonContent(SuccessSchema, "Holding deleted"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    await deleteInvestmentHoldingService(userId, id, prisma);
    return c.json({ message: "Investment holding deleted successfully" }, OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
