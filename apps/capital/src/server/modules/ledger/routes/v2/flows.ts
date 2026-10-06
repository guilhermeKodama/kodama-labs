import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { cashflowSankey, ledgerFlowsInputSchema } from "../../services/flows";

/**
 * Ledger flow endpoints, built on the display rows and their flowKind
 * (../../lib/flow-sql.ts). Mounted in src/server/routes.ts.
 */

const flowsRoute = createRoute({
  method: "post",
  path: "/v2/ledger/flows",
  tags: ["Ledger v2"],
  summary: "Cash-flow sankey of a selection: income → PJ → PF → expense categories, investments, surplus",
  request: jsonBody(ledgerFlowsInputSchema),
  responses: v2Responses,
});

export const ledgerFlowRoutes = createRouter().openapi(flowsRoute, v2Handler(flowsRoute, (c, userId) => cashflowSankey(userId, c.req.valid("json"), prisma)));
