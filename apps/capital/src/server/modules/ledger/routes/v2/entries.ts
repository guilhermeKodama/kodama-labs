import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { createEntrySchema, deleteEntrySchema, entryPatchSchema } from "../../contracts";
import { createEntry, getEntry, softDeleteEntries, updateEntry } from "../../services/entries";
import { getEntryHistory } from "../../services/history";
import { deleteWithScope, getDeleteOptions } from "../../services/scope-delete";

const tags = ["Ledger v2"];

const getEntryRoute = createRoute({ method: "get", path: "/v2/ledger/entries/{id}", tags, summary: "Get one entry", request: { params: idParams }, responses: v2Responses });

const createEntryRoute = createRoute({
  method: "post",
  path: "/v2/ledger/entries",
  tags,
  summary: "Create an income/expense (optionally in installments) or a transfer",
  request: jsonBody(createEntrySchema),
  responses: v2Responses,
});

const patchEntryRoute = createRoute({
  method: "patch",
  path: "/v2/ledger/entries/{id}",
  tags,
  summary: "Update an entry (transfer legs stay in sync)",
  request: { params: idParams, ...jsonBody(entryPatchSchema) },
  responses: v2Responses,
});

const deleteEntryRoute = createRoute({ method: "delete", path: "/v2/ledger/entries/{id}", tags, summary: "Move an entry (and its transfer legs) to the trash", request: { params: idParams }, responses: v2Responses });

const deleteOptionsRoute = createRoute({
  method: "get",
  path: "/v2/ledger/entries/{id}/delete-options",
  tags,
  summary: "What deleting an entry can take with it: kind (simple|recurring|installment|linked), occurrence n/total, rows and sum per scope, linked operation",
  request: { params: idParams },
  responses: v2Responses,
});

const scopedDeleteRoute = createRoute({
  method: "post",
  path: "/v2/ledger/entries/{id}/delete",
  tags,
  summary: "Delete an entry with a scope (one, future, all) and optionally its linked investment operation, in one undo batch",
  request: { params: idParams, ...jsonBody(deleteEntrySchema) },
  responses: v2Responses,
});

const historyRoute = createRoute({
  method: "get",
  path: "/v2/ledger/entries/{id}/history",
  tags,
  summary: "The entry's history: origin (import, recurrence, copy), the rule that categorized it, and every live change with its source",
  request: { params: idParams },
  responses: v2Responses,
});

export const ledgerEntryRoutes = createRouter()
  .openapi(getEntryRoute, v2Handler(getEntryRoute, (c, userId) => getEntry(userId, c.req.valid("param").id, prisma)))
  .openapi(
    createEntryRoute,
    v2Handler(createEntryRoute, async (c, userId) => {
      const result = await createEntry(userId, c.req.valid("json"), prisma);
      const entries = await Promise.all(result.entryIds.map((id) => getEntry(userId, id, prisma)));
      return { ...result, entries };
    })
  )
  .openapi(
    patchEntryRoute,
    v2Handler(patchEntryRoute, async (c, userId) => {
      const { batchId, entry } = await updateEntry(userId, c.req.valid("param").id, c.req.valid("json"), prisma);
      return { batchId, entry };
    })
  )
  .openapi(deleteEntryRoute, v2Handler(deleteEntryRoute, (c, userId) => softDeleteEntries(userId, [c.req.valid("param").id], prisma)))
  .openapi(deleteOptionsRoute, v2Handler(deleteOptionsRoute, (c, userId) => getDeleteOptions(userId, c.req.valid("param").id, prisma)))
  .openapi(scopedDeleteRoute, v2Handler(scopedDeleteRoute, (c, userId) => deleteWithScope(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(historyRoute, v2Handler(historyRoute, (c, userId) => getEntryHistory(userId, c.req.valid("param").id, prisma)));
