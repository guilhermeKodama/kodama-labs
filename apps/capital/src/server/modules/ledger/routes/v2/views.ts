import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { duplicateViewSchema, savedViewInputSchema, savedViewPatchSchema } from "../../contracts";
import { createView, deleteView, duplicateView, listViews, reorderViews, updateView } from "../../services/views";

const tags = ["Ledger v2"];

const listViewsRoute = createRoute({
  method: "get",
  path: "/v2/views",
  tags,
  summary: "Saved views (creates Todas and the default views on first access)",
  request: { query: z.object({ dataset: z.string().optional() }) },
  responses: v2Responses,
});
const createViewRoute = createRoute({ method: "post", path: "/v2/views", tags, summary: "Create a view (undoable: returns batchId). Without a name it is called \"Nova view\", \"Nova view 2\"… per dataset, in the user's locale, and not recorded (batchId null)", request: jsonBody(savedViewInputSchema), responses: v2Responses });
const patchViewRoute = createRoute({ method: "patch", path: "/v2/views/{id}", tags, summary: "Update a view (auto-save; a rename or favorite toggle returns batchId, config edits are not recorded)", request: { params: idParams, ...jsonBody(savedViewPatchSchema) }, responses: v2Responses });
const deleteViewRoute = createRoute({ method: "delete", path: "/v2/views/{id}", tags, summary: "Delete a view (undoable: undo restores it under the same id)", request: { params: idParams }, responses: v2Responses });
const duplicateViewRoute = createRoute({
  method: "post",
  path: "/v2/views/{id}/duplicate",
  tags,
  summary: "Duplicate a view, optionally with the config on screen (not recorded: batchId null, like an unnamed create)",
  request: { params: idParams, ...jsonBody(duplicateViewSchema) },
  responses: v2Responses,
});
const reorderViewsRoute = createRoute({ method: "put", path: "/v2/views/order", tags, summary: "Reorder views", request: jsonBody(z.object({ ids: z.array(z.string()).min(1) })), responses: v2Responses });

export const ledgerViewRoutes = createRouter()
  .openapi(listViewsRoute, v2Handler(listViewsRoute, (c, userId) => listViews(userId, prisma, c.req.valid("query").dataset)))
  .openapi(createViewRoute, v2Handler(createViewRoute, (c, userId) => createView(userId, c.req.valid("json"), prisma)))
  .openapi(patchViewRoute, v2Handler(patchViewRoute, (c, userId) => updateView(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(
    deleteViewRoute,
    v2Handler(deleteViewRoute, async (c, userId) => {
      const { batchId } = await deleteView(userId, c.req.valid("param").id, prisma);
      return { ok: true, batchId };
    })
  )
  .openapi(duplicateViewRoute, v2Handler(duplicateViewRoute, (c, userId) => duplicateView(userId, c.req.valid("param").id, prisma, c.req.valid("json"))))
  .openapi(reorderViewsRoute, v2Handler(reorderViewsRoute, (c, userId) => reorderViews(userId, c.req.valid("json").ids, prisma)));
