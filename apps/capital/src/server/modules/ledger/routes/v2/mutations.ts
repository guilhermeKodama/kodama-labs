import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { listBatches, undoBatch } from "../../services/mutations";

const tags = ["Ledger v2"];

const batchesRoute = createRoute({
  method: "get",
  path: "/v2/mutations",
  tags,
  summary: "Recent changes (undo history), each with its source (user, import, assistant, mcp, system); undoable=true keeps the user-facing ones that can be undone now, newest first (⌘Z takes the first; system batches such as cron bookings are never offered)",
  request: { query: z.object({ undoable: queryFlag.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) },
  responses: v2Responses,
});
const undoRoute = createRoute({ method: "post", path: "/v2/mutations/{id}/undo", tags, summary: "Undo a change batch", request: { params: idParams }, responses: v2Responses });

export const ledgerMutationRoutes = createRouter()
  .openapi(batchesRoute, v2Handler(batchesRoute, (c, userId) => listBatches(userId, prisma, c.req.valid("query"))))
  .openapi(undoRoute, v2Handler(undoRoute, (c, userId) => undoBatch(userId, c.req.valid("param").id, prisma)));
