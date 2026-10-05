import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { entityScopeQuery, resolveScopeQuery } from "@capital/server/lib/entity-scope";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createBudget, deactivateBudget, listBudgets, serializeBudget, updateBudget } from "../../services/budget-crud";
import { monthOverview, yearOverview } from "../../services/budget-overview";

const tags = ["Budgets v2"];

/** The serialized budget plus the undo batch of the write. */
const withBatch = (b: Parameters<typeof serializeBudget>[0] & { batchId: string | null }) => ({ ...serializeBudget(b), batchId: b.batchId });
const monthOrDay = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);

const budgetInput = z.object({
  entityId: z.string().nullish(),
  categoryId: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  period: z.enum(["monthly", "yearly"]).optional(),
  effectiveFrom: monthOrDay,
  rollover: z.boolean().optional(),
});

const listRoute = createRoute({
  method: "get",
  path: "/v2/budgets",
  tags,
  summary: "Budgets, optionally only those in force at a date",
  request: { query: z.object({ entityId: z.string().optional(), categoryId: z.string().optional(), effectiveAt: monthOrDay.optional() }) },
  responses: v2Responses,
});
const createBudgetRoute = createRoute({ method: "post", path: "/v2/budgets", tags, summary: "Create a budget", request: jsonBody(budgetInput), responses: v2Responses });
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/budgets/{id}",
  tags,
  summary: "Update a budget",
  request: {
    params: idParams,
    ...jsonBody(z.object({ amount: z.number().positive().optional(), currency: z.string().length(3).optional(), period: z.enum(["monthly", "yearly"]).optional(), effectiveFrom: monthOrDay.optional(), rollover: z.boolean().optional(), isActive: z.boolean().optional() }).strict()),
  },
  responses: v2Responses,
});
const deleteRouteDef = createRoute({ method: "delete", path: "/v2/budgets/{id}", tags, summary: "Deactivate a budget. Undoable (batchId).", request: { params: idParams }, responses: v2Responses });
const overviewRoute = createRoute({
  method: "get",
  path: "/v2/budgets/overview",
  tags,
  summary: "Monthly (?month=YYYY-MM: pace, projection, upcoming bills) or yearly (?year=YYYY: category x month matrix with trends) overview; scope = all | pf | pj | <entityId>",
  request: { query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), year: z.string().regex(/^\d{4}$/).optional(), ...entityScopeQuery }) },
  responses: v2Responses,
});

export const v2Budgets = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (c, userId) => ({ budgets: (await listBudgets(userId, prisma, c.req.valid("query"))).map(serializeBudget) })))
  .openapi(overviewRoute, v2Handler(overviewRoute, async (c, userId) => {
    const q = c.req.valid("query");
    if (!q.month && !q.year) throw new LedgerError("Pass month=YYYY-MM or year=YYYY", 400, { code: "budget.overview_period_required" });
    const entityIds = await resolveScopeQuery(userId, q, prisma);
    if (q.month) {
      const [y, m] = q.month.split("-").map(Number);
      return monthOverview(userId, y, m, prisma, { entityIds });
    }
    return yearOverview(userId, Number(q.year), prisma, { entityIds });
  }))
  .openapi(createBudgetRoute, v2Handler(createBudgetRoute, async (c, userId) => withBatch(await createBudget(userId, c.req.valid("json"), prisma))))
  .openapi(patchRoute, v2Handler(patchRoute, async (c, userId) => withBatch(await updateBudget(userId, c.req.valid("param").id, c.req.valid("json"), prisma))))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => withBatch(await deactivateBudget(userId, c.req.valid("param").id, prisma))));
