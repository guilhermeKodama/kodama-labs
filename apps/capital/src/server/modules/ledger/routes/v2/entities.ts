import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { createEntity, listEntitiesWithAccountCounts, patchEntity } from "../../services/entities";

const tags = ["Ledger v2"];

const entityBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  defaultCurrency: z.string().length(3).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  color: z.string().nullish(),
  initialBalance: z.number().optional(),
});
const listEntitiesRoute = createRoute({ method: "get", path: "/v2/entities", tags, summary: "PF and businesses, each with accountsCount (its unarchived accounts and cards)", request: { query: z.object({ includeArchived: queryFlag.optional() }) }, responses: v2Responses });
const createEntityRoute = createRoute({ method: "post", path: "/v2/entities", tags, summary: "Create a business with its main account (undoable: returns batchId)", request: jsonBody(entityBody), responses: v2Responses });
const patchEntityRoute = createRoute({
  method: "patch",
  path: "/v2/entities/{id}",
  tags,
  summary: "Update or archive an entity (undoable: returns batchId)",
  request: { params: idParams, ...jsonBody(entityBody.partial().extend({ archived: z.boolean().optional() })) },
  responses: v2Responses,
});

export const ledgerEntityRoutes = createRouter()
  .openapi(listEntitiesRoute, v2Handler(listEntitiesRoute, (c, userId) => listEntitiesWithAccountCounts(userId, prisma, { includeArchived: c.req.valid("query").includeArchived })))
  .openapi(createEntityRoute, v2Handler(createEntityRoute, (c, userId) => createEntity(userId, { ...c.req.valid("json"), kind: "business" }, prisma)))
  .openapi(
    patchEntityRoute,
    v2Handler(patchEntityRoute, (c, userId) => patchEntity(userId, c.req.valid("param").id, c.req.valid("json"), prisma))
  );
