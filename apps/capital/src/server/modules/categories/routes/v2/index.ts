import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import {
  categoryUsage,
  createCategory,
  deleteCategory,
  findUncategorized,
  getOwnedCategory,
  listCategories,
  mergeCategories,
  serializeCategory,
  updateCategory,
} from "../../services/categories";

const tags = ["Categories v2"];
const typeSchema = z.enum(["income", "expense", "investment"]);

const listRoute = createRoute({
  method: "get",
  path: "/v2/categories",
  tags,
  summary: "List categories",
  request: { query: z.object({ type: typeSchema.optional(), includeArchived: z.enum(["true", "false"]).optional() }) },
  responses: v2Responses,
});
const createRouteDef = createRoute({
  method: "post",
  path: "/v2/categories",
  tags,
  summary: "Create a category",
  request: jsonBody(z.object({ name: z.string().min(1).max(80), type: typeSchema, color: z.string().nullish(), icon: z.string().nullish() })),
  responses: v2Responses,
});
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/categories/{id}",
  tags,
  summary: "Rename, recolor, retype or archive a category",
  request: {
    params: idParams,
    ...jsonBody(z.object({ name: z.string().min(1).max(80).optional(), type: typeSchema.optional(), color: z.string().nullish(), icon: z.string().nullish(), isArchived: z.boolean().optional() }).strict()),
  },
  responses: v2Responses,
});
const usageRoute = createRoute({ method: "get", path: "/v2/categories/{id}/usage", tags, summary: "Records that point at a category", request: { params: idParams }, responses: v2Responses });
const deleteRouteDef = createRoute({
  method: "delete",
  path: "/v2/categories/{id}",
  tags,
  summary: "Delete a category, optionally reassigning everything that uses it. Undoable (batchId).",
  request: { params: idParams, query: z.object({ reassignTo: z.string().optional() }) },
  responses: v2Responses,
});
const mergeRoute = createRoute({
  method: "post",
  path: "/v2/categories/merge",
  tags,
  summary: "Move everything from one category into another and delete the source. Undoable (batchId).",
  request: jsonBody(z.object({ fromId: z.string(), toId: z.string() })),
  responses: v2Responses,
});
const uncategorizedRoute = createRoute({
  method: "get",
  path: "/v2/categories/uncategorized",
  tags,
  summary: "Entries with no category or an archived one",
  request: { query: z.object({ entityId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) },
  responses: v2Responses,
});

export const v2Categories = createRouter()
  .openapi(
    listRoute,
    v2Handler(listRoute, async (c, userId) => {
      const q = c.req.valid("query");
      return { categories: (await listCategories(userId, prisma, { type: q.type, includeArchived: q.includeArchived === "true" })).map(serializeCategory) };
    })
  )
  .openapi(uncategorizedRoute, v2Handler(uncategorizedRoute, async (c, userId) => {
    const { total, rows } = await findUncategorized(userId, prisma, c.req.valid("query"));
    return {
      total,
      entries: rows.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        description: e.description,
        amount: Number(e.amount),
        currency: e.currency,
        kind: e.kind,
        entity: e.entity,
        category: e.category,
      })),
    };
  }))
  .openapi(createRouteDef, v2Handler(createRouteDef, async (c, userId) => serializeCategory(await createCategory(userId, c.req.valid("json"), prisma))))
  .openapi(patchRoute, v2Handler(patchRoute, async (c, userId) => {
    const category = await updateCategory(userId, c.req.valid("param").id, c.req.valid("json"), prisma);
    return { ...serializeCategory(category), batchId: category.batchId };
  }))
  .openapi(usageRoute, v2Handler(usageRoute, async (c, userId) => {
    const { id } = c.req.valid("param");
    await getOwnedCategory(userId, id, prisma);
    return categoryUsage(userId, id, prisma);
  }))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => deleteCategory(userId, c.req.valid("param").id, c.req.valid("query").reassignTo, prisma)))
  .openapi(mergeRoute, v2Handler(mergeRoute, async (c, userId) => {
    const { fromId, toId } = c.req.valid("json");
    return mergeCategories(userId, fromId, toId, prisma);
  }));
