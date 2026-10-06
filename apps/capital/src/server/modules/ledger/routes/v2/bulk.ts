import { createRoute, type z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { bulkOperationSchema, ledgerSelectionQuerySchema } from "../../contracts";
import { bulkUpdateEntries, duplicateEntries, previewBulkUpdate, softDeleteEntries } from "../../services/entries";
import { selectEntryIds } from "../../services/query-engine";

const tags = ["Ledger v2"];

const bulkRoute = createRoute({
  method: "post",
  path: "/v2/ledger/bulk",
  tags,
  summary: "Bulk update, delete or duplicate a selection (a transfer counts as one row); update with dryRun only counts what would change",
  request: jsonBody(bulkOperationSchema),
  responses: v2Responses,
});

async function resolveSelection(userId: string, selection: z.infer<typeof bulkOperationSchema>["selection"]) {
  return "ids" in selection ? selection.ids : selectEntryIds(userId, ledgerSelectionQuerySchema.parse(selection.query), prisma);
}

export const ledgerBulkRoutes = createRouter().openapi(
  bulkRoute,
  v2Handler(bulkRoute, async (c, userId) => {
    const op = c.req.valid("json");
    const ids = await resolveSelection(userId, op.selection);
    if (op.op === "update" && op.dryRun) {
      const preview = ids.length ? await previewBulkUpdate(userId, ids, op.patch, prisma, { createRule: op.createRule }) : { matched: 0, changed: 0, byField: {}, rulesLearned: 0 };
      return { dryRun: true, ...preview };
    }
    if (!ids.length) return { batchId: null, affected: 0 };
    if (op.op === "delete") {
      const r = await softDeleteEntries(userId, ids, prisma, { summary: `${ids.length} entries` });
      return { batchId: r.batchId, affected: r.deleted };
    }
    if (op.op === "duplicate") {
      const r = await duplicateEntries(userId, ids, prisma);
      return { batchId: r.batchId, affected: r.entryIds.length, entryIds: r.entryIds };
    }
    const r = await bulkUpdateEntries(userId, ids, op.patch, prisma, { createRule: op.createRule });
    return { batchId: r.batchId, affected: r.changed, matched: r.matched, rulesLearned: r.rulesLearned };
  })
);
