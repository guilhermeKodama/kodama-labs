import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@capital/server/lib/prisma";
import { createRouter } from "@capital/server/lib/router";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { isPluggyConfigured } from "../../lib/config";
import { createPluggyClient } from "../../lib/client";
import { anthropicIncomeGuesser } from "../../lib/guesser";
import { createPluggyItem, deletePluggyItem, mapPluggyAccount, pluggyOverview, resolvePluggyReview, updatePluggyItem } from "../../services/items";
import { startPluggySync } from "../../services/sync";

const tags = ["Pluggy v2"];
const entityKind = z.enum(["personal", "business"]);

const overviewRoute = createRoute({ method: "get", path: "/v2/pluggy", tags, summary: "Open Finance status, item ids, account mapping and the review queue", responses: v2Responses });
const createRoute_ = createRoute({
  method: "post",
  path: "/v2/pluggy/items",
  tags,
  summary: "Save a Meu Pluggy item id",
  request: jsonBody(z.object({ label: z.string().min(1).max(80), itemId: z.string().min(1), entityKind })),
  responses: v2Responses,
});
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/pluggy/items/{id}",
  tags,
  summary: "Rename a connection, replace its item id, or set the brokerage, income category and import cutoff",
  request: {
    params: idParams,
    ...jsonBody(
      z.object({
        label: z.string().min(1).max(80).optional(),
        itemId: z.string().min(1).optional(),
        entityKind: entityKind.optional(),
        brokerageAccountId: z.string().nullable().optional(),
        incomeCategoryId: z.string().nullable().optional(),
        syncCutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
    ),
  },
  responses: v2Responses,
});
const deleteRoute = createRoute({ method: "delete", path: "/v2/pluggy/items/{id}", tags, summary: "Remove a connection. Booked entries stay.", request: { params: idParams }, responses: v2Responses });
const mapRoute = createRoute({
  method: "patch",
  path: "/v2/pluggy/links/{id}",
  tags,
  summary: "Map a Pluggy account to a Cerne account of the connection's entity",
  request: { params: idParams, ...jsonBody(z.object({ capitalAccountId: z.string().nullable() })) },
  responses: v2Responses,
});
const syncRoute = createRoute({
  method: "post",
  path: "/v2/pluggy/sync",
  tags,
  summary: "Start a sync and return the run id. The page polls status. No credentials means the sync is disabled.",
  request: jsonBody(z.object({ itemRowId: z.string().optional() })),
  responses: v2Responses,
});
const reviewRoute = createRoute({
  method: "post",
  path: "/v2/pluggy/reviews/{id}",
  tags,
  summary: "Ignore a review, link it to an existing entry, or confirm a classification",
  request: {
    params: idParams,
    ...jsonBody(
      z.object({
        action: z.enum(["ignore", "link", "confirm"]),
        ledgerEntryId: z.string().nullable().optional(),
        incomeType: z.enum(["dividend", "jcp", "fii_income", "fixed_income_interest"]).optional(),
        origin: z.enum(["BR", "BDR", "EXTERIOR"]).nullable().optional(),
      }),
    ),
  },
  responses: v2Responses,
});

function deps() {
  return { db: prisma, client: createPluggyClient(), now: new Date(), guesser: anthropicIncomeGuesser(), enabled: isPluggyConfigured() };
}

export const v2Pluggy = createRouter()
  .openapi(overviewRoute, v2Handler(overviewRoute, async (_c, userId) => pluggyOverview(userId, prisma)))
  .openapi(createRoute_, v2Handler(createRoute_, async (c, userId) => createPluggyItem(userId, c.req.valid("json"), prisma)))
  .openapi(patchRoute, v2Handler(patchRoute, async (c, userId) => updatePluggyItem(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(deleteRoute, v2Handler(deleteRoute, async (c, userId) => {
    await deletePluggyItem(userId, c.req.valid("param").id, prisma);
    return { ok: true };
  }))
  .openapi(mapRoute, v2Handler(mapRoute, async (c, userId) => mapPluggyAccount(userId, c.req.valid("param").id, c.req.valid("json").capitalAccountId, prisma)))
  .openapi(syncRoute, v2Handler(syncRoute, async (c, userId) => startPluggySync(userId, deps(), { itemRowId: c.req.valid("json").itemRowId })))
  .openapi(reviewRoute, v2Handler(reviewRoute, async (c, userId) => {
    const body = c.req.valid("json");
    return resolvePluggyReview(userId, c.req.valid("param").id, body.action, body.ledgerEntryId ?? null, prisma, {
      incomeType: body.incomeType,
      origin: body.origin,
    });
  }));
