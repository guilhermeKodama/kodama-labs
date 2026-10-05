import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { createEntrySchema, entryPatchSchema } from "../../contracts";
import { createEntry, getEntry, softDeleteEntries, updateEntry } from "../../services/entries";

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
  .openapi(deleteEntryRoute, v2Handler(deleteEntryRoute, (c, userId) => softDeleteEntries(userId, [c.req.valid("param").id], prisma)));
