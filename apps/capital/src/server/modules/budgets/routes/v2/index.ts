import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { entityScopeQuery, resolveScopeQuery } from "@capital/server/lib/entity-scope";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createBudget, deactivateBudget, deleteBudgetChain, endBudgetFrom, listBudgets, serializeBudget, updateBudget } from "../../services/budget-crud";
import { monthOverview, yearOverview } from "../../services/budget-overview";

const tags = ["Budgets v2"];

/** The serialized budget plus the undo batch of the write. */
const withBatch = (b: Parameters<typeof serializeBudget>[0] & { batchId: string | null }) => ({ ...serializeBudget(b), batchId: b.batchId });
const monthOrDay = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);
const notes = z.string().trim().max(200).nullish().transform((v) => (v === undefined ? undefined : v || null));

const budgetInput = z.object({
  entityId: z.string().nullish(),
  categoryId: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  period: z.enum(["monthly", "yearly"]).optional(),
  effectiveFrom: monthOrDay,
  rollover: z.boolean().optional(),
  notes,
});

const budgetPatch = z
  .object({
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    period: z.enum(["monthly", "yearly"]).optional(),
    effectiveFrom: monthOrDay.optional(),
    rollover: z.boolean().optional(),
    isActive: z.boolean().optional(),
    notes,
    applyFrom: yearMonth.optional().describe("YYYY-MM: keep earlier months and apply the change from this month on (a new version)"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!p.applyFrom) return;
    for (const key of ["period", "effectiveFrom", "isActive"] as const) {
      if (p[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `${key} cannot be changed together with applyFrom` });
    }
  });

const listRoute = createRoute({
  method: "get",
  path: "/v2/budgets",
  tags,
  summary: "Budgets, optionally only those in force at a date",
  request: { query: z.object({ entityId: z.string().optional(), categoryId: z.string().optional(), effectiveAt: monthOrDay.optional() }) },
  responses: v2Responses,
});
const createBudgetRoute = createRoute({ method: "post", path: "/v2/budgets", tags, summary: "Create a budget. Undoable (batchId).", request: jsonBody(budgetInput), responses: v2Responses });
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/budgets/{id}",
  tags,
  summary: "Update a budget: in place, or with applyFrom as a new version from that month on (earlier months keep their amount). Undoable (batchId).",
  request: { params: idParams, ...jsonBody(budgetPatch) },
  responses: v2Responses,
});
const deleteRouteDef = createRoute({
  method: "delete",
  path: "/v2/budgets/{id}",
  tags,
  summary: "?from=YYYY-MM ends the budget from that month on (earlier months keep it); ?all=true deletes every version; neither deactivates this version. Undoable (batchId).",
  request: { params: idParams, query: z.object({ from: yearMonth.optional(), all: queryFlag.optional() }) },
  responses: v2Responses,
});
const overviewRoute = createRoute({
  method: "get",
  path: "/v2/budgets/overview",
  tags,
  summary:
    "Monthly (?month=YYYY-MM: pace, projection, upcoming bills) or yearly (?year=YYYY: budget x month matrix with trends and insights) overview; scope = all | pf | pj | <entityId>; onlyBudgeted=false adds unbudgeted rows to the matrix",
  request: {
    query: z.object({ month: yearMonth.optional(), year: z.string().regex(/^\d{4}$/).optional(), onlyBudgeted: queryFlag.optional(), ...entityScopeQuery }),
  },
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
    return yearOverview(userId, Number(q.year), prisma, { entityIds, onlyBudgeted: q.onlyBudgeted });
  }))
  .openapi(createBudgetRoute, v2Handler(createBudgetRoute, async (c, userId) => withBatch(await createBudget(userId, c.req.valid("json"), prisma))))
  .openapi(patchRoute, v2Handler(patchRoute, async (c, userId) => withBatch(await updateBudget(userId, c.req.valid("param").id, c.req.valid("json"), prisma))))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => {
    const id = c.req.valid("param").id;
    const q = c.req.valid("query");
    if (q.all) return withBatch(await deleteBudgetChain(userId, id, prisma));
    if (q.from) return withBatch(await endBudgetFrom(userId, id, q.from, prisma));
    return withBatch(await deactivateBudget(userId, id, prisma));
  }));
