import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import {
  accountTypeSchema,
  bulkOperationSchema,
  createEntrySchema,
  entryPatchSchema,
  ledgerQuerySchema,
  ledgerSelectionQuerySchema,
  savedViewInputSchema,
  savedViewPatchSchema,
} from "../../contracts";
import { LedgerError } from "../../lib/errors";
import { createAccount, listAccounts, serializeAccount, updateAccount } from "../../services/accounts";
import {
  bulkUpdateEntries,
  createEntry,
  duplicateEntries,
  getEntry,
  purgeTrash,
  restoreEntries,
  softDeleteEntries,
  updateEntry,
} from "../../services/entries";
import { archiveEntity, createEntity, listEntities, updateEntity } from "../../services/entities";
import { listBatches, undoBatch } from "../../services/mutations";
import { exportLedgerCsv, queryLedger, selectEntryIds } from "../../services/query-engine";
import { createRule, deleteRule, RULE_MATCH_TYPES, testRules, updateRule } from "../../services/rules";
import { markStatementPayment, unmarkStatementPayment } from "../../services/statements";
import {
  createView,
  deleteView,
  duplicateView,
  listViews,
  reorderViews,
  updateView,
  viewSelection,
} from "../../services/views";

const tags = ["Ledger v2"];

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const queryRoute = createRoute({
  method: "post",
  path: "/v2/ledger/query",
  tags,
  summary: "Query the ledger: filters, period, grouping, aggregations, pivot, paging",
  request: jsonBody(ledgerQuerySchema),
  responses: v2Responses,
});

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

const bulkRoute = createRoute({ method: "post", path: "/v2/ledger/bulk", tags, summary: "Bulk update, delete or duplicate a selection", request: jsonBody(bulkOperationSchema), responses: v2Responses });

const exportRoute = createRoute({
  method: "post",
  path: "/v2/ledger/export",
  tags,
  summary: "Export a view or a selection as CSV",
  request: jsonBody(z.union([z.object({ viewId: z.string() }), z.object({ query: ledgerSelectionQuerySchema })])),
  responses: v2Responses,
});

async function resolveSelection(userId: string, selection: z.infer<typeof bulkOperationSchema>["selection"]) {
  return "ids" in selection ? selection.ids : selectEntryIds(userId, ledgerSelectionQuerySchema.parse(selection.query), prisma);
}

// ---------------------------------------------------------------------------
// Undo + trash
// ---------------------------------------------------------------------------

const batchesRoute = createRoute({ method: "get", path: "/v2/mutations", tags, summary: "Recent changes (undo history)", responses: v2Responses });
const undoRoute = createRoute({ method: "post", path: "/v2/mutations/{id}/undo", tags, summary: "Undo a change batch", request: { params: idParams }, responses: v2Responses });
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

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const listViewsRoute = createRoute({ method: "get", path: "/v2/views", tags, summary: "Saved views", request: { query: z.object({ dataset: z.string().optional() }) }, responses: v2Responses });
const createViewRoute = createRoute({ method: "post", path: "/v2/views", tags, summary: "Create a view", request: jsonBody(savedViewInputSchema), responses: v2Responses });
const patchViewRoute = createRoute({ method: "patch", path: "/v2/views/{id}", tags, summary: "Update a view (auto-save)", request: { params: idParams, ...jsonBody(savedViewPatchSchema) }, responses: v2Responses });
const deleteViewRoute = createRoute({ method: "delete", path: "/v2/views/{id}", tags, summary: "Delete a view", request: { params: idParams }, responses: v2Responses });
const duplicateViewRoute = createRoute({ method: "post", path: "/v2/views/{id}/duplicate", tags, summary: "Duplicate a view", request: { params: idParams, ...jsonBody(z.object({ name: z.string().optional() })) }, responses: v2Responses });
const reorderViewsRoute = createRoute({ method: "put", path: "/v2/views/order", tags, summary: "Reorder views", request: jsonBody(z.object({ ids: z.array(z.string()).min(1) })), responses: v2Responses });

// ---------------------------------------------------------------------------
// Entities + accounts + statements + rules
// ---------------------------------------------------------------------------

const entityBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  defaultCurrency: z.string().length(3).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  color: z.string().nullish(),
  initialBalance: z.number().optional(),
});
const listEntitiesRoute = createRoute({ method: "get", path: "/v2/entities", tags, summary: "PF and businesses", request: { query: z.object({ includeArchived: z.coerce.boolean().optional() }) }, responses: v2Responses });
const createEntityRoute = createRoute({ method: "post", path: "/v2/entities", tags, summary: "Create a business", request: jsonBody(entityBody), responses: v2Responses });
const patchEntityRoute = createRoute({
  method: "patch",
  path: "/v2/entities/{id}",
  tags,
  summary: "Update or archive an entity",
  request: { params: idParams, ...jsonBody(entityBody.partial().extend({ archived: z.boolean().optional() })) },
  responses: v2Responses,
});

const accountBody = z.object({
  entityId: z.string(),
  type: accountTypeSchema,
  name: z.string().min(1),
  institution: z.string().nullish(),
  currency: z.string().length(3).optional(),
  externalId: z.string().nullish(),
  initialBalance: z.number().optional(),
  color: z.string().nullish(),
  creditLimit: z.number().positive().nullish(),
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  payFromAccountId: z.string().nullish(),
});
const listAccountsRoute = createRoute({
  method: "get",
  path: "/v2/accounts",
  tags,
  summary: "Accounts with balances",
  request: { query: z.object({ type: accountTypeSchema.optional(), entityId: z.string().optional(), includeArchived: z.coerce.boolean().optional() }) },
  responses: v2Responses,
});
const createAccountRoute = createRoute({ method: "post", path: "/v2/accounts", tags, summary: "Create a checking account, card, broker or cash account", request: jsonBody(accountBody), responses: v2Responses });
const patchAccountRoute = createRoute({
  method: "patch",
  path: "/v2/accounts/{id}",
  tags,
  summary: "Update or archive an account",
  request: { params: idParams, ...jsonBody(accountBody.omit({ entityId: true, type: true }).partial().extend({ archived: z.boolean().optional() })) },
  responses: v2Responses,
});
const statementsRoute = createRoute({ method: "get", path: "/v2/accounts/{id}/statements", tags, summary: "Card statements with totals", request: { params: idParams }, responses: v2Responses });
const markPaymentRoute = createRoute({
  method: "post",
  path: "/v2/card-statements/{id}/payment",
  tags,
  summary: "Mark an expense as the payment of a statement",
  request: { params: idParams, ...jsonBody(z.object({ entryId: z.string() })) },
  responses: v2Responses,
});
const unmarkPaymentRoute = createRoute({
  method: "delete",
  path: "/v2/card-statements/payment/{id}",
  tags,
  summary: "Undo a statement payment link (id = checking-leg entry id)",
  request: { params: idParams },
  responses: v2Responses,
});

const ruleBody = z.object({ matchType: z.enum(RULE_MATCH_TYPES), pattern: z.string().min(1), categoryId: z.string(), entityId: z.string().nullish() });
const listRulesRoute = createRoute({ method: "get", path: "/v2/rules", tags, summary: "Categorization rules", responses: v2Responses });
const createRuleRoute = createRoute({ method: "post", path: "/v2/rules", tags, summary: "Create a rule", request: jsonBody(ruleBody), responses: v2Responses });
const patchRuleRoute = createRoute({ method: "patch", path: "/v2/rules/{id}", tags, summary: "Update a rule", request: { params: idParams, ...jsonBody(ruleBody.partial()) }, responses: v2Responses });
const deleteRuleRoute = createRoute({ method: "delete", path: "/v2/rules/{id}", tags, summary: "Delete a rule", request: { params: idParams }, responses: v2Responses });
const testRuleRoute = createRoute({ method: "post", path: "/v2/rules/test", tags, summary: "Which rule categorizes a description", request: jsonBody(z.object({ description: z.string().min(1) })), responses: v2Responses });

// ---------------------------------------------------------------------------

const router = createRouter()
  .openapi(queryRoute, v2Handler(queryRoute, (c, userId) => queryLedger(userId, c.req.valid("json"), prisma)))
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
  .openapi(deleteEntryRoute, v2Handler(deleteEntryRoute, (c, userId) => softDeleteEntries(userId, [c.req.valid("param").id], prisma)))
  .openapi(
    bulkRoute,
    v2Handler(bulkRoute, async (c, userId) => {
      const op = c.req.valid("json");
      const ids = await resolveSelection(userId, op.selection);
      if (!ids.length) return { batchId: null, affected: 0 };
      if (op.op === "delete") {
        const r = await softDeleteEntries(userId, ids, prisma, { summary: `${ids.length} entries` });
        return { batchId: r.batchId, affected: r.deleted };
      }
      if (op.op === "duplicate") {
        const r = await duplicateEntries(userId, ids, prisma);
        return { batchId: r.batchId, affected: r.entryIds.length, entryIds: r.entryIds };
      }
      const r = await bulkUpdateEntries(userId, ids, op.patch, prisma, { createRule: op.createRule });
      return { batchId: r.batchId, affected: r.changed, matched: r.matched };
    })
  )
  .openapi(
    exportRoute,
    v2Handler(exportRoute, async (c, userId) => {
      const body = c.req.valid("json");
      const selection = "viewId" in body ? await viewSelection(userId, body.viewId, prisma) : ledgerSelectionQuerySchema.parse(body.query);
      const csv = await exportLedgerCsv(userId, ledgerSelectionQuerySchema.parse(selection), prisma);
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="capital-export.csv"` },
      });
    })
  )
  .openapi(
    batchesRoute,
    v2Handler(batchesRoute, async (_c, userId) =>
      (await listBatches(userId, prisma)).map((b) => ({ id: b.id, op: b.op, summary: b.summary, records: b._count.records, undoneAt: b.undoneAt, createdAt: b.createdAt }))
    )
  )
  .openapi(undoRoute, v2Handler(undoRoute, (c, userId) => undoBatch(userId, c.req.valid("param").id, prisma)))
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
  .openapi(purgeRoute, v2Handler(purgeRoute, (_c, userId) => purgeTrash(prisma, 0, userId)))
  .openapi(listViewsRoute, v2Handler(listViewsRoute, (c, userId) => listViews(userId, prisma, c.req.valid("query").dataset)))
  .openapi(createViewRoute, v2Handler(createViewRoute, (c, userId) => createView(userId, c.req.valid("json"), prisma)))
  .openapi(patchViewRoute, v2Handler(patchViewRoute, (c, userId) => updateView(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(
    deleteViewRoute,
    v2Handler(deleteViewRoute, async (c, userId) => {
      await deleteView(userId, c.req.valid("param").id, prisma);
      return { ok: true };
    })
  )
  .openapi(duplicateViewRoute, v2Handler(duplicateViewRoute, (c, userId) => duplicateView(userId, c.req.valid("param").id, prisma, c.req.valid("json").name)))
  .openapi(reorderViewsRoute, v2Handler(reorderViewsRoute, (c, userId) => reorderViews(userId, c.req.valid("json").ids, prisma)))
  .openapi(listEntitiesRoute, v2Handler(listEntitiesRoute, (c, userId) => listEntities(userId, prisma, { includeArchived: c.req.valid("query").includeArchived })))
  .openapi(createEntityRoute, v2Handler(createEntityRoute, (c, userId) => createEntity(userId, { ...c.req.valid("json"), kind: "business" }, prisma)))
  .openapi(
    patchEntityRoute,
    v2Handler(patchEntityRoute, async (c, userId) => {
      const { archived, ...patch } = c.req.valid("json");
      const id = c.req.valid("param").id;
      if (archived !== undefined) await archiveEntity(userId, id, archived, prisma);
      return Object.keys(patch).length ? updateEntity(userId, id, patch, prisma) : prisma.entity.findUniqueOrThrow({ where: { id } });
    })
  )
  .openapi(listAccountsRoute, v2Handler(listAccountsRoute, async (c, userId) => (await listAccounts(userId, prisma, c.req.valid("query"))).map(serializeAccount)))
  .openapi(createAccountRoute, v2Handler(createAccountRoute, async (c, userId) => serializeAccount(await createAccount(userId, c.req.valid("json"), prisma))))
  .openapi(patchAccountRoute, v2Handler(patchAccountRoute, async (c, userId) => serializeAccount(await updateAccount(userId, c.req.valid("param").id, c.req.valid("json"), prisma))))
  .openapi(
    statementsRoute,
    v2Handler(statementsRoute, async (c, userId) => {
      const accountId = c.req.valid("param").id;
      const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
      if (!account) throw new LedgerError("Account not found", 404);
      const statements = await prisma.cardStatement.findMany({ where: { accountId }, orderBy: { month: "desc" } });
      const totals = await prisma.ledgerEntry.groupBy({
        by: ["cardStatementId"],
        where: { accountId, deletedAt: null, cardStatementId: { in: statements.map((s) => s.id) } },
        _sum: { amountBase: true, amount: true },
        _count: true,
      });
      const byId = new Map(totals.map((t) => [t.cardStatementId, t]));
      return statements.map((s) => ({
        id: s.id,
        month: s.month,
        closingDate: s.closingDate,
        dueDate: s.dueDate,
        declaredTotal: s.totalAmount == null ? null : Number(s.totalAmount),
        purchasesTotal: -Number(byId.get(s.id)?._sum.amount ?? 0),
        purchaseCount: byId.get(s.id)?._count ?? 0,
        paymentGroupId: s.paymentGroupId,
      }));
    })
  )
  .openapi(markPaymentRoute, v2Handler(markPaymentRoute, (c, userId) => markStatementPayment(userId, c.req.valid("json").entryId, c.req.valid("param").id, prisma)))
  .openapi(unmarkPaymentRoute, v2Handler(unmarkPaymentRoute, (c, userId) => unmarkStatementPayment(userId, c.req.valid("param").id, prisma)))
  .openapi(listRulesRoute, v2Handler(listRulesRoute, (_c, userId) => prisma.categorizationRule.findMany({ where: { userId }, orderBy: [{ hitCount: "desc" }, { pattern: "asc" }], include: { category: { select: { name: true } } } })))
  .openapi(createRuleRoute, v2Handler(createRuleRoute, (c, userId) => createRule(userId, c.req.valid("json"), prisma)))
  .openapi(patchRuleRoute, v2Handler(patchRuleRoute, (c, userId) => updateRule(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(
    deleteRuleRoute,
    v2Handler(deleteRuleRoute, async (c, userId) => {
      await deleteRule(userId, c.req.valid("param").id, prisma);
      return { ok: true };
    })
  )
  .openapi(testRuleRoute, v2Handler(testRuleRoute, (c, userId) => testRules(userId, c.req.valid("json").description, prisma)));

export default router;
