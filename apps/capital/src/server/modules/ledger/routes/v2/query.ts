import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { ledgerQuerySchema, ledgerSelectionQuerySchema } from "../../contracts";
import { exportLedgerCsv, queryLedger, type ExportTarget } from "../../services/query-engine";
import { viewSelection } from "../../services/views";

const tags = ["Ledger v2"];

const queryRoute = createRoute({
  method: "post",
  path: "/v2/ledger/query",
  tags,
  summary: "Query the ledger: filters, period, grouping, aggregations, pivot, paging; legs or display rows",
  request: jsonBody(ledgerQuerySchema),
  responses: v2Responses,
});

/** A saved view, a selection query, or rows by id (bulk "Exportar"; a transfer brings both legs). */
const exportBodySchema = z.union([
  z.object({ viewId: z.string() }),
  z.object({ query: ledgerSelectionQuerySchema }),
  z.object({ ids: z.array(z.string()).min(1).max(5000) }),
]);

const exportRoute = createRoute({
  method: "post",
  path: "/v2/ledger/export",
  tags,
  summary: "Export a view, a selection or rows by id as CSV (in the user's language)",
  request: jsonBody(exportBodySchema),
  responses: v2Responses,
});

export const ledgerQueryRoutes = createRouter()
  .openapi(queryRoute, v2Handler(queryRoute, (c, userId) => queryLedger(userId, c.req.valid("json"), prisma)))
  .openapi(
    exportRoute,
    v2Handler(exportRoute, async (c, userId) => {
      const body = c.req.valid("json");
      let target: ExportTarget;
      if ("ids" in body) target = { ids: body.ids };
      else if ("viewId" in body) target = ledgerSelectionQuerySchema.parse(await viewSelection(userId, body.viewId, prisma));
      else target = ledgerSelectionQuerySchema.parse(body.query);
      const csv = await exportLedgerCsv(userId, target, prisma);
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="capital-export.csv"` },
      });
    })
  );
