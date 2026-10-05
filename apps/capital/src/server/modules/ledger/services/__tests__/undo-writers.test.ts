import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { ToolContext } from "@capital/server/modules/assistant/agent/tools/registry";
import { recordMerchantCategory } from "@capital/server/modules/assistant/agent/tools/write/record-merchant-category";
import { updateBillTransactions } from "@capital/server/modules/assistant/agent/tools/write/update-bill-transactions";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { executeImport } from "@capital/server/modules/bank-statements/services/execute-import";
import { createBudget, deactivateBudget, updateBudget } from "@capital/server/modules/budgets/services/budget-crud";
import { deleteCategory, mergeCategories, updateCategory } from "@capital/server/modules/categories/services/categories";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createHolding, recordOperation, updateOperation } from "@capital/server/modules/investments/services/portfolio";
import {
  createRecurringRule,
  deleteRecurringRule,
  markRulePaid,
  processDueRules,
  skipRuleOccurrence,
  updateRecurringRule,
} from "@capital/server/modules/recurring/services/recurring-rules";
import { toNumber } from "../../lib/money";
import { createEntry, restoreEntries, softDeleteEntries, updateEntry } from "../entries";
import { listBatches, recordMutation, snapshot, undoBatch, type MutationRecordInput } from "../mutations";
import { createRule, deleteRule, updateRule } from "../rules";

const USER = "test-user-undo-writers-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const batchOf = (id: string) => prisma.mutationBatch.findUniqueOrThrow({ where: { id }, include: { records: true } });
const rule = (id: string) => prisma.recurringRule.findUniqueOrThrow({ where: { id } });
const bill = (data: { recurringRuleId?: string; ledgerEntryId?: string }) =>
  prisma.attachment.create({ data: { kind: "BILL", blobUrl: "https://blob.test/conta.pdf", pathname: "conta.pdf", mimeType: "application/pdf", sizeBytes: 10, originalName: "conta.pdf", ...data } });
const monthly = (overrides: Record<string, unknown> = {}) => ({
  kind: "expense" as const,
  accountId: f.pfChecking,
  amount: 120,
  description: "Luz",
  categoryId: f.categories.Groceries,
  frequency: "monthly" as const,
  startDate: "2026-08-10",
  autoGenerate: false,
  ...overrides,
});

describe("undo passes", () => {
  it("points rows back before removing the rows the batch created, so a created category goes too", async () => {
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 30, description: "Ração", date: "2026-09-02", categoryId: f.categories.Groceries }, prisma);
    const pets = await prisma.category.create({ data: { userId: USER, name: "Pets", type: "expense" } });
    const records: MutationRecordInput[] = [{ model: "Category", recordId: pets.id, before: null, after: snapshot(pets) }];
    await updateEntry(USER, e.entryIds[0], { categoryId: pets.id }, prisma, { collect: records });
    const batchId = await recordMutation(prisma, USER, "create", "Pets", records);

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.category.count({ where: { id: pets.id } })).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(f.categories.Groceries);
  });

  it("keeps a created entry that has attachments the batch did not record", async () => {
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 99, description: "Farmácia", date: "2026-09-03" }, prisma);
    const receipt = await bill({ ledgerEntryId: e.entryIds[0] });

    await undoBatch(USER, e.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: e.entryIds[0] } })).toBe(1);
    expect(await prisma.attachment.count({ where: { id: receipt.id } })).toBe(1);
    expect((await batchOf(e.batchId!)).undoneAt).not.toBeNull();
  });
});

describe("recurring rules", () => {
  it("undoes create, update, skip and delete; delete brings back the rule's bills and links its occurrences again", async () => {
    const created = await createRecurringRule(USER, monthly(), prisma);
    const edited = await updateRecurringRule(USER, created.id, { amount: 150, description: "Luz Enel" }, prisma);
    const skipped = await skipRuleOccurrence(USER, created.id, prisma);
    expect(skipped.nextDueDate.toISOString().slice(0, 10)).toBe("2026-09-10");

    await undoBatch(USER, skipped.batchId, prisma);
    expect((await rule(created.id)).nextDueDate).toEqual(created.nextDueDate);
    await undoBatch(USER, edited.batchId!, prisma);
    expect(await rule(created.id)).toMatchObject({ description: "Luz" });
    expect(toNumber((await rule(created.id)).amount)).toBe(120);
    await undoBatch(USER, created.batchId!, prisma);
    expect(await prisma.recurringRule.count({ where: { id: created.id } })).toBe(0);

    const r = await createRecurringRule(USER, monthly({ description: "Internet" }), prisma);
    const paid = await markRulePaid(USER, r.id, prisma);
    const pending = await bill({ recurringRuleId: r.id });
    const deleted = await deleteRecurringRule(USER, r.id, prisma);
    expect(await prisma.attachment.count({ where: { id: pending.id } })).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.entryIds[0] } })).recurringRuleId).toBeNull();

    await undoBatch(USER, deleted.batchId!, prisma);
    expect(await rule(r.id)).toMatchObject({ description: "Internet", createdAt: r.createdAt });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ recurringRuleId: r.id, originalName: "conta.pdf" });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.entryIds[0] } })).recurringRuleId).toBe(r.id);
  });

  it("undoes a payment: the occurrence goes, its bill returns to the rule and the due date rewinds", async () => {
    const r = await createRecurringRule(USER, monthly(), prisma);
    const pending = await bill({ recurringRuleId: r.id });
    const paid = await markRulePaid(USER, r.id, prisma, { amount: 130 });
    expect(paid.batchId).toBeTruthy();
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ recurringRuleId: null, ledgerEntryId: paid.entryIds[0] });

    await undoBatch(USER, paid.batchId, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: paid.entryIds[0] } })).toBe(0);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ recurringRuleId: r.id, ledgerEntryId: null });
    expect(await rule(r.id)).toMatchObject({ nextDueDate: r.nextDueDate, lastGeneratedDate: null });
  });

  it("records the cron's bookings as a system batch that ⌘Z skips and that blocks undoing older rule edits", async () => {
    const r = await createRecurringRule(USER, monthly({ autoGenerate: true }), prisma);
    const edit = await updateRecurringRule(USER, r.id, { amount: 140 }, prisma);
    const run = await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"), { userId: USER });
    expect(run.results).toHaveLength(1);
    const { batchId, generated } = run.results[0];
    expect(generated).toBe(2);
    const batch = await batchOf(batchId);
    expect(batch.source).toBe("system");
    expect(batch.records.filter((x) => x.model === "LedgerEntry")).toHaveLength(2);

    expect((await listBatches(USER, prisma)).map((b) => b.id)).toContain(batchId);
    expect((await listBatches(USER, prisma, { undoable: true })).map((b) => b.id)).not.toContain(batchId);
    await expect(undoBatch(USER, edit.batchId!, prisma)).rejects.toMatchObject({ status: 409, code: "undo.newer_change" });

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: r.id } })).toBe(0);
    expect((await rule(r.id)).nextDueDate).toEqual(r.nextDueDate);
    await undoBatch(USER, edit.batchId!, prisma);
    expect(toNumber((await rule(r.id)).amount)).toBe(120);
  });
});

describe("budgets", () => {
  it("undoes create, edit and deactivation, and a reactivation back to inactive", async () => {
    const created = await createBudget(USER, { categoryId: f.categories.Groceries, amount: 500, effectiveFrom: "2026-09" }, prisma);
    const edited = await updateBudget(USER, created.id, { amount: 650 }, prisma);
    const off = await deactivateBudget(USER, created.id, prisma);
    expect((await batchOf(off.batchId!)).op).toBe("delete");

    await undoBatch(USER, off.batchId!, prisma);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(true);
    await undoBatch(USER, edited.batchId!, prisma);
    expect(toNumber((await prisma.budget.findUniqueOrThrow({ where: { id: created.id } })).amount)).toBe(500);
    await undoBatch(USER, created.batchId!, prisma);
    expect(await prisma.budget.count({ where: { id: created.id } })).toBe(0);

    const first = await createBudget(USER, { categoryId: f.categories.Software, amount: 100, effectiveFrom: "2026-09" }, prisma);
    await deactivateBudget(USER, first.id, prisma);
    const again = await createBudget(USER, { categoryId: f.categories.Software, amount: 120, effectiveFrom: "2026-09" }, prisma);
    expect(again.id).toBe(first.id);
    await undoBatch(USER, again.batchId!, prisma);
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.isActive).toBe(false);
    expect(toNumber(row.amount)).toBe(100);
  });
});

describe("categories", () => {
  it("undoes an archive", async () => {
    const archived = await updateCategory(USER, f.categories.Software, { isArchived: true }, prisma);
    expect(archived.isArchived).toBe(true);
    await undoBatch(USER, archived.batchId, prisma);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: f.categories.Software } })).isArchived).toBe(false);
  });

  it("undoes a merge: the source comes back and everything moved points at it again", async () => {
    const from = await prisma.category.create({ data: { userId: USER, name: "Delivery", type: "expense", color: "pink" } });
    const live = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 40, description: "iFood", date: "2026-09-04", categoryId: from.id }, prisma);
    const trashed = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 25, description: "Rappi", date: "2026-09-05", categoryId: from.id }, prisma);
    await softDeleteEntries(USER, trashed.entryIds, prisma);
    const learned = await createRule(USER, { matchType: "contains", pattern: "ifood", categoryId: from.id }, prisma);
    const budget = await createBudget(USER, { categoryId: from.id, amount: 300, effectiveFrom: "2026-09" }, prisma);
    const recurring = await createRecurringRule(USER, monthly({ categoryId: from.id, description: "Assinatura iFood" }), prisma);

    const merged = await mergeCategories(USER, from.id, f.categories.Groceries, prisma);
    expect(merged).toMatchObject({ transactionsMoved: 2, budgetsMoved: 1, recurringTransactionsMoved: 1, rulesMoved: 1 });
    expect((await batchOf(merged.batchId)).op).toBe("merge");

    await undoBatch(USER, merged.batchId, prisma);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: from.id } })).toMatchObject({ name: "Delivery", color: "pink", createdAt: from.createdAt });
    const entries = await prisma.ledgerEntry.findMany({ where: { id: { in: [...live.entryIds, ...trashed.entryIds] } } });
    expect(entries.map((e) => e.categoryId)).toEqual([from.id, from.id]);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: learned.id } })).categoryId).toBe(from.id);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).categoryId).toBe(from.id);
    expect((await rule(recurring.id)).categoryId).toBe(from.id);
  });

  it("undoes a delete, pointing the trashed entries it cleared back at the category", async () => {
    const old = await prisma.category.create({ data: { userId: USER, name: "Antiga", type: "expense" } });
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "x", date: "2026-09-01", categoryId: old.id }, prisma);
    await softDeleteEntries(USER, e.entryIds, prisma);

    const deleted = await deleteCategory(USER, old.id, undefined, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBeNull();
    await undoBatch(USER, deleted.batchId, prisma);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ name: "Antiga" });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(old.id);
  });
});

describe("categorization rules", () => {
  it("undoes create, update and delete", async () => {
    const created = await createRule(USER, { matchType: "contains", pattern: "uber", categoryId: f.categories.Software }, prisma);
    const updated = await updateRule(USER, created.id, { categoryId: f.categories.Groceries }, prisma);
    const deleted = await deleteRule(USER, created.id, prisma);

    await undoBatch(USER, deleted.batchId, prisma);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: created.id } })).categoryId).toBe(f.categories.Groceries);
    await undoBatch(USER, updated.batchId, prisma);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: created.id } })).categoryId).toBe(f.categories.Software);
    await undoBatch(USER, created.batchId, prisma);
    expect(await prisma.categorizationRule.count({ where: { id: created.id } })).toBe(0);
  });

  it("records what the assistant's rule tools learn", async () => {
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "t" } });
    const ctx = { userId: USER, conversationId: conversation.id, db: prisma } as ToolContext;
    const learned = (await recordMerchantCategory.handler(ctx, { normalizedDescription: "Padaria Pão Quente", category: "Groceries" })) as { createdRecords: { id: string }[] };
    const ruleId = learned.createdRecords[0].id;
    const [learnBatch] = await listBatches(USER, prisma, { limit: 1 });
    expect(learnBatch).toMatchObject({ op: "create", records: 1 });
    await undoBatch(USER, learnBatch.id, prisma);
    expect(await prisma.categorizationRule.count({ where: { id: ruleId } })).toBe(0);

    const purchase = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-12", description: "Netflix", amount: 55 }], fallback: "none" }, prisma);
    await updateBillTransactions.handler(ctx, { updates: [{ billTransactionId: purchase.createdIds[0], category: "Software" }] });
    const [fix] = await listBatches(USER, prisma, { limit: 1 });
    expect(fix.records).toBe(2);
    await undoBatch(USER, fix.id, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchase.createdIds[0] } })).categoryId).toBeNull();
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "netflix" } })).toBe(0);
  });
});

describe("imports", () => {
  const plan = (overrides: Partial<ImportPlanPayload> = {}): ImportPlanPayload =>
    ({
      entityType: "personal",
      entityId: f.pfId,
      bankName: "Nubank",
      fileName: "extrato.ofx",
      currency: "BRL",
      transactions: [{ externalId: "fit-1", date: "2026-09-02", description: "Padaria", amount: 25, type: "expense", category: "Groceries" }],
      transfers: [
        { externalId: "fit-2", date: "2026-09-04", description: "Pró-labore", amount: 3000, flow: "inflow", direction: "profit_distribution", counterpartyEntityType: "business", counterpartyEntityId: f.pjId },
      ],
      investmentTransfers: [],
      creditCards: [{ bankName: "Inter", lastFourDigits: "4321", closingDay: 3, dueDay: 10, currency: "BRL" }],
      bills: [],
      reconciliations: [],
      transferReconciliations: [],
      duplicateDecisions: [],
      investmentTransactions: [],
      ...overrides,
    }) as ImportPlanPayload;

  it("records an import as one batch from the import source, and undo removes it and restores what it changed", async () => {
    const before = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 80, description: "Mercado", date: "2026-09-01" }, prisma);
    const fuzzy = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 12, description: "Café", date: "2026-09-01" }, prisma);
    const result = await executeImport(
      USER,
      plan({
        reconciliations: [{ existingTransactionId: before.entryIds[0], externalId: "fit-8", updates: { amount: 82.5 } }],
        duplicateDecisions: [{ externalId: "fit-9", resolution: "link_fuzzy", existingTransactionId: fuzzy.entryIds[0] }],
      } as Partial<ImportPlanPayload>),
      prisma
    );
    const batch = await batchOf(result.batchId);
    expect(batch).toMatchObject({ op: "import", source: "import" });
    const cardId = result.createdRecords.find((r) => r.model === "Account")!.id;

    await undoBatch(USER, result.batchId, prisma);
    expect(await prisma.import.count({ where: { id: result.statementImportId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, OR: [{ externalId: "fit-1" }, { transferGroup: { externalId: "fit-2" } }] } })).toBe(0);
    expect(await prisma.transferGroup.count({ where: { userId: USER, externalId: "fit-2" } })).toBe(0);
    expect(await prisma.account.count({ where: { id: cardId } })).toBe(0);
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: before.entryIds[0] } })).amount)).toBe(-80);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: fuzzy.entryIds[0] } })).externalId).toBeNull();
  });

  it("undoes a card statement import, bringing back the committed installment it replaced", async () => {
    const row = (n: number) => ({ date: "2026-08-15", description: "Notebook", amount: 1000, installment: { number: n, total: 3 } });
    const first = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row(1)] }, prisma);
    expect((await batchOf(first.batchId!)).source).toBe("import");
    const projected = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, installmentNumber: 2 } });
    const october = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-10" } });

    const second = await importCardStatement(USER, { accountId: f.card, month: "2026-10", dueDate: "2026-10-20", total: 1000, rows: [row(2)] }, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: projected.id } })).toBe(0);

    await undoBatch(USER, second.batchId!, prisma);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: projected.id } })).toMatchObject({ installmentNumber: 2, metadata: projected.metadata });
    expect(await prisma.ledgerEntry.count({ where: { id: { in: second.createdIds } } })).toBe(0);
    expect(await prisma.cardStatement.findUniqueOrThrow({ where: { id: october.id } })).toMatchObject({ dueDate: october.dueDate, totalAmount: october.totalAmount });

    await undoBatch(USER, first.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: f.card } })).toBe(0);
    expect(await prisma.installmentPlan.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.cardStatement.count({ where: { accountId: f.card } })).toBe(0);
  });
});

describe("restoring a cash leg an edit trashed", () => {
  it("refuses: the operation is still there and no longer counts that cash", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ABEV3", name: "Ambev" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 12, totalAmount: 120, date: "2026-09-01" }, prisma);
    await updateOperation(USER, buy.operation.id, { type: "split" }, prisma);

    await expect(restoreEntries(USER, [buy.cashEntryId!], prisma)).rejects.toMatchObject({ status: 409, code: "trash.operation_edited" });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).not.toBeNull();
  });
});
