import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { purgeTrash, restoreEntries } from "../../services/entries";
import { queryLedger } from "../../services/query-engine";

const tags = ["Ledger v2"];

const trashRoute = createRoute({
  method: "get",
  path: "/v2/trash",
  tags,
  summary: "Entries in the trash",
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), cursor: z.string().optional() }) },
  responses: v2Responses,
});
const restoreRoute = createRoute({ method: "post", path: "/v2/trash/restore", tags, summary: "Restore entries from the trash", request: jsonBody(z.object({ ids: z.array(z.string()).min(1) })), responses: v2Responses });
const purgeRoute = createRoute({ method: "delete", path: "/v2/trash", tags, summary: "Empty the trash now", responses: v2Responses });

export const ledgerTrashRoutes = createRouter()
  .openapi(
    trashRoute,
    v2Handler(trashRoute, (c, userId) => {
      const { limit, cursor } = c.req.valid("query");
      return queryLedger(
        userId,
        {
          deleted: "only",
          period: { preset: "all", offset: 0 },
          sort: [{ field: "date", dir: "desc" }],
          page: { limit: limit ?? 100, cursor },
          aggregations: [{ fn: "count", field: "amountBase" }],
        },
        prisma
      );
    })
  )
  .openapi(restoreRoute, v2Handler(restoreRoute, (c, userId) => restoreEntries(userId, c.req.valid("json").ids, prisma)))
  .openapi(purgeRoute, v2Handler(purgeRoute, (_c, userId) => purgeTrash(prisma, 0, userId)));
