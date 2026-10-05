import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { ledgerQuerySchema, ledgerSelectionQuerySchema } from "../../contracts";
import { exportLedgerCsv, queryLedger } from "../../services/query-engine";
import { viewSelection } from "../../services/views";

const tags = ["Ledger v2"];

const queryRoute = createRoute({
  method: "post",
  path: "/v2/ledger/query",
  tags,
  summary: "Query the ledger: filters, period, grouping, aggregations, pivot, paging",
  request: jsonBody(ledgerQuerySchema),
  responses: v2Responses,
});

const exportRoute = createRoute({
  method: "post",
  path: "/v2/ledger/export",
  tags,
  summary: "Export a view or a selection as CSV",
  request: jsonBody(z.union([z.object({ viewId: z.string() }), z.object({ query: ledgerSelectionQuerySchema })])),
  responses: v2Responses,
});

export const ledgerQueryRoutes = createRouter()
  .openapi(queryRoute, v2Handler(queryRoute, (c, userId) => queryLedger(userId, c.req.valid("json"), prisma)))
  .openapi(
    exportRoute,
    v2Handler(exportRoute, async (c, userId) => {
      const body = c.req.valid("json");
      const selection = "viewId" in body ? await viewSelection(userId, body.viewId, prisma) : ledgerSelectionQuerySchema.parse(body.query);
      const csv = await exportLedgerCsv(userId, ledgerSelectionQuerySchema.parse(selection), prisma);
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="capital-export.csv"` },
      });
    })
  );
