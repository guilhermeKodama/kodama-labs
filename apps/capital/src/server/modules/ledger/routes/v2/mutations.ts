import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { listBatches, undoBatch } from "../../services/mutations";

const tags = ["Ledger v2"];

const batchesRoute = createRoute({ method: "get", path: "/v2/mutations", tags, summary: "Recent changes (undo history)", responses: v2Responses });
const undoRoute = createRoute({ method: "post", path: "/v2/mutations/{id}/undo", tags, summary: "Undo a change batch", request: { params: idParams }, responses: v2Responses });

export const ledgerMutationRoutes = createRouter()
  .openapi(
    batchesRoute,
    v2Handler(batchesRoute, async (_c, userId) =>
      (await listBatches(userId, prisma)).map((b) => ({ id: b.id, op: b.op, summary: b.summary, records: b._count.records, undoneAt: b.undoneAt, createdAt: b.createdAt }))
    )
  )
  .openapi(undoRoute, v2Handler(undoRoute, (c, userId) => undoBatch(userId, c.req.valid("param").id, prisma)));
