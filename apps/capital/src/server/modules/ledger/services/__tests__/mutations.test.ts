import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, deleteOperation, recordOperation, updateOperation } from "@capital/server/modules/investments/services/portfolio";
import { toNumber } from "../../lib/money";
import { createEntry, restoreEntries, softDeleteEntries, updateEntry } from "../entries";
import {
  MUTATION_MODELS,
  REMOVE_ORDER,
  RESTORE_ORDER,
  listBatches,
  recordMutation,
  snapshot,
  undoBatch,
  withMutationSource,
  type MutationRecordInput,
} from "../mutations";
import { createRule } from "../rules";

const USER = "test-user-ledger-mutations-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const batchOf = (id: string) => prisma.mutationBatch.findUniqueOrThrow({ where: { id }, include: { records: true } });

describe("model registry", () => {
  it("orders every registered model: parents restored first, children removed first", () => {
    expect([...RESTORE_ORDER].sort()).toEqual([...MUTATION_MODELS].sort());
    expect(REMOVE_ORDER).toEqual([...RESTORE_ORDER].reverse());
    const before = (a: string, b: string) => REMOVE_ORDER.indexOf(a as never) < REMOVE_ORDER.indexOf(b as never);
    expect(before("InvestmentOperation", "LedgerEntry")).toBe(true);
    expect(before("LedgerEntry", "TransferGroup")).toBe(true);
    expect(before("LedgerEntry", "CardStatement")).toBe(true);
    expect(before("CardStatement", "TransferGroup")).toBe(true);
    expect(before("TransferGroup", "InstallmentPlan")).toBe(true);
    expect(before("InstallmentPlan", "RecurringRule")).toBe(true);
    expect(before("RecurringRule", "CategorizationRule")).toBe(true);
    expect(before("CategorizationRule", "Budget")).toBe(true);
    expect(before("InvestmentOperation", "InvestmentHolding")).toBe(true);
    // Attachments hang off entries, transfers and recurring rules.
    expect(["LedgerEntry", "TransferGroup", "RecurringRule"].every((parent) => before("Attachment", parent))).toBe(true);
    // Entities own accounts; accounts and categories are parents of nearly everything: re-created first, removed last.
    expect(RESTORE_ORDER.slice(0, 4)).toEqual(["Entity", "SavedView", "Account", "Category"]);
  });

  it("refuses batches with records of an unregistered model", async () => {
    const batchId = await recordMutation(prisma, USER, "update", null, [
      { model: "Holding" as never, recordId: "x", before: { a: 1 }, after: { a: 2 } },
    ]);
    await expect(undoBatch(USER, batchId, prisma)).rejects.toMatchObject({ code: "undo.unsupported", params: { model: "Holding" } });
  });
});

describe("undoBatch", () => {
  it("re-creates a row the batch deleted outright, with its id and fields", async () => {
    const rule = await createRule(USER, { matchType: "contains", pattern: "figma", categoryId: f.categories.Software }, prisma);
    const row = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } });
    await prisma.categorizationRule.delete({ where: { id: rule.id } });
    const batchId = await recordMutation(prisma, USER, "delete", "rule", [{ model: "CategorizationRule", recordId: row.id, before: snapshot(row), after: null }]);

    await undoBatch(USER, batchId, prisma);
    const back = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: row.id } });
    expect(back).toMatchObject({ userId: USER, pattern: "figma", categoryId: f.categories.Software, matchType: row.matchType, createdAt: row.createdAt });
  });

  it("re-creates parents before children whatever order the records were written in", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 300, date: "2026-09-10", description: "Aporte PJ" }, prisma);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } });
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: group.id } });
    await prisma.transferGroup.delete({ where: { id: group.id } }); // cascades the legs
    // Legs recorded first: undo must still create the group before them.
    const records: MutationRecordInput[] = [
      ...legs.map((l) => ({ model: "LedgerEntry" as const, recordId: l.id, before: snapshot(l), after: null })),
      { model: "TransferGroup", recordId: group.id, before: snapshot(group), after: null },
    ];
    const batchId = await recordMutation(prisma, USER, "delete", null, records);

    await undoBatch(USER, batchId, prisma);
    const restored = await prisma.ledgerEntry.findMany({ where: { transferGroupId: group.id }, orderBy: { amount: "asc" } });
    expect(restored.map((l) => [l.id, toNumber(l.amount), l.accountId])).toEqual(
      legs.sort((a, b) => toNumber(a.amount) - toNumber(b.amount)).map((l) => [l.id, toNumber(l.amount), l.accountId])
    );
    expect(restored.every((l) => l.metadata === null)).toBe(true);
  });

  it("still restores an update recorded with after = null (card payments before the registry)", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 90, description: "Uber", date: "2026-09-02" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    const legacy = await recordMutation(prisma, USER, "update", null, [{ model: "CardStatement", recordId: statement.id, before: snapshot(statement), after: null }]);
    await prisma.cardStatement.update({ where: { id: statement.id }, data: { dueDate: new Date("2030-01-01") } });

    await undoBatch(USER, legacy, prisma);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).dueDate).toEqual(statement.dueDate);
  });

  it("undoes a card payment: the transfer goes and the statement is open again", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 90, description: "Uber", date: "2026-09-02" }, prisma);
    const pay = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.card, amount: 90, date: "2026-09-12" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    expect(statement.paymentGroupId).toBe(pay.transferGroupId);
    const batch = await batchOf(pay.batchId!);
    expect(batch.records.find((r) => r.model === "CardStatement")?.after).toMatchObject({ paymentGroupId: pay.transferGroupId });

    await undoBatch(USER, pay.batchId!, prisma);
    expect(await prisma.transferGroup.count({ where: { id: pay.transferGroupId! } })).toBe(0);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBeNull();
  });

  it("removes the installment plan with its parcels", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, installments: 3, description: "TV", date: "2026-09-02" }, prisma);
    const planId = (await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } })).installmentPlanId!;
    expect((await batchOf(r.batchId!)).records.map((rec) => rec.model)).toContain("InstallmentPlan");

    await undoBatch(USER, r.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: r.entryIds } } })).toBe(0);
    expect(await prisma.installmentPlan.count({ where: { id: planId } })).toBe(0);
  });

  it("recalculates the holding after undoing an operation's create and update", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ITSA4", name: "Itaúsa", currentPrice: 10 }, prisma);
    const first = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 10, totalAmount: 1000, date: "2026-09-01" }, prisma);
    const second = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 50, pricePerUnit: 12, totalAmount: 600, date: "2026-09-02", fundFromAccountId: f.pfChecking }, prisma);
    expect(second.batchId).not.toBeNull();
    expect((await batchOf(second.batchId!)).records.map((r) => r.model).sort()).toEqual(["InvestmentOperation", "LedgerEntry", "LedgerEntry", "LedgerEntry", "TransferGroup"]);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).currentQuantity).toBe(150);

    const edit = await updateOperation(USER, first.operation.id, { quantity: 80, totalAmount: 800 }, prisma);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).currentQuantity).toBe(130);
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: first.cashEntryId! } })).amount)).toBe(-800);

    await undoBatch(USER, edit.batchId!, prisma);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).currentQuantity).toBe(150);
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: first.cashEntryId! } })).amount)).toBe(-1000);

    await undoBatch(USER, second.batchId!, prisma);
    const holding = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } });
    expect(holding).toMatchObject({ currentQuantity: 100, averageCost: 10, totalInvested: 1000 });
    expect(await prisma.investmentOperation.count({ where: { id: second.operation.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { id: second.cashEntryId! } })).toBe(0);
    expect(await prisma.transferGroup.count({ where: { id: second.fundingGroupId! } })).toBe(0);
  });

  it("trashes the cash leg when an edit stops the operation moving cash, and undo links it back", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "BBAS3", name: "BB" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 20, totalAmount: 200, date: "2026-09-01" }, prisma);
    const edit = await updateOperation(USER, buy.operation.id, { type: "split" }, prisma);
    expect(edit.operation.cashEntryId).toBeNull();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).not.toBeNull();

    await undoBatch(USER, edit.batchId!, prisma);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: buy.operation.id } })).cashEntryId).toBe(buy.cashEntryId);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).toBeNull();
  });

  it("books a cash leg when an edit makes the operation move cash, and undo removes it", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "KLBN11", name: "Klabin" }, prisma);
    const split = await recordOperation(USER, { holdingId: h.id, type: "split", quantity: 5, totalAmount: 0, date: "2026-09-01" }, prisma);
    expect(split.cashEntryId).toBeNull();
    const edit = await updateOperation(USER, split.operation.id, { type: "buy", pricePerUnit: 20, totalAmount: 100 }, prisma);
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: edit.operation.cashEntryId! } });
    expect(leg).toMatchObject({ kind: "investment", accountId: f.broker, description: "Compra KLBN11" });
    expect(toNumber(leg.amount)).toBe(-100);

    await undoBatch(USER, edit.batchId!, prisma);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: split.operation.id } })).toMatchObject({ type: "split", cashEntryId: null });
    expect(await prisma.ledgerEntry.count({ where: { id: leg.id } })).toBe(0);
  });
});

describe("deleteOperation", () => {
  it("snapshots the operation, trashes its cash leg and funding transfer, and undo brings them all back", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "WEGE3", name: "WEG", currentPrice: 40 }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, fees: 1, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    const fundingLegs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: buy.fundingGroupId! } });

    const del = await deleteOperation(USER, buy.operation.id, prisma, { withFunding: true });
    expect(del).toMatchObject({ deleted: buy.operation.id, cashEntryId: buy.cashEntryId, fundingGroupId: buy.fundingGroupId });
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).not.toBeNull();
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: buy.fundingGroupId! } })).deletedAt).not.toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { transferGroupId: buy.fundingGroupId!, deletedAt: null } })).toBe(0);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).currentQuantity).toBe(0);

    await undoBatch(USER, del.batchId!, prisma);
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: buy.operation.id } });
    expect(op).toMatchObject({ cashEntryId: buy.cashEntryId, fundingGroupId: buy.fundingGroupId, quantity: 10, totalAmount: 400, fees: 1 });
    expect(op.date).toEqual(buy.operation.date);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).toBeNull();
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: buy.fundingGroupId! } })).deletedAt).toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { id: { in: fundingLegs.map((l) => l.id) }, deletedAt: null } })).toBe(2);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).currentQuantity).toBe(10);
  });

  it("leaves the funding transfer alone unless asked", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 60, totalAmount: 60, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    const del = await deleteOperation(USER, buy.operation.id, prisma);
    expect(del.fundingGroupId).toBeNull();
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: buy.fundingGroupId! } })).deletedAt).toBeNull();
  });
});

describe("restoring an operation's cash leg from the trash", () => {
  const position = (holdingId: string) => prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } }).then((h) => h.currentQuantity);

  it("brings back the deleted operation and its position; undoing the restore takes them away again", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "EGIE3", name: "Engie" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    await deleteOperation(USER, buy.operation.id, prisma);
    expect(await position(h.id)).toBe(0);

    const restored = await restoreEntries(USER, [buy.cashEntryId!], prisma);
    expect(restored).toMatchObject({ restored: 1, operationsRestored: 1 });
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: buy.operation.id } });
    expect(op).toMatchObject({ cashEntryId: buy.cashEntryId, fundingGroupId: buy.fundingGroupId, quantity: 10, totalAmount: 400 });
    expect(op.date).toEqual(buy.operation.date);
    expect(await position(h.id)).toBe(10);

    await undoBatch(USER, restored.batchId, prisma);
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).not.toBeNull();
    expect(await position(h.id)).toBe(0);
  });

  it("leaves an operation that still exists alone", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "SAPR11", name: "Sanepar" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 5, pricePerUnit: 30, totalAmount: 150, date: "2026-09-01" }, prisma);
    await softDeleteEntries(USER, [buy.cashEntryId!], prisma);

    expect(await restoreEntries(USER, [buy.cashEntryId!], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: buy.operation.id } })).cashEntryId).toBe(buy.cashEntryId);
  });

  it("refuses when the operation was recorded again since, and restores nothing", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "CPLE6", name: "Copel" }, prisma);
    const input = { holdingId: h.id, type: "buy" as const, quantity: 20, pricePerUnit: 10, totalAmount: 200, date: "2026-09-01", externalId: "nota-77" };
    const buy = await recordOperation(USER, input, prisma);
    await deleteOperation(USER, buy.operation.id, prisma);
    await recordOperation(USER, input, prisma);

    await expect(restoreEntries(USER, [buy.cashEntryId!], prisma)).rejects.toMatchObject({ status: 409, code: "trash.operation_recorded_again" });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).deletedAt).not.toBeNull();
    expect(await position(h.id)).toBe(20);
  });
});

describe("registry models beyond the ledger", () => {
  it("writes back only the columns the batch changed", async () => {
    const created = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    const id = created.entryIds[0];
    const edit = await updateEntry(USER, id, { amount: 12 }, prisma);
    // Written outside the log after the batch: undo leaves it.
    await prisma.ledgerEntry.update({ where: { id }, data: { notes: "conferido" } });

    await undoBatch(USER, edit.batchId!, prisma);
    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
    expect(toNumber(row.amount)).toBe(-10);
    expect(row.notes).toBe("conferido");
  });

  it("keeps a holding's price fetched after the edit it undoes", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ITSA4", name: "Itaúsa", currentPrice: 10 }, prisma);
    const before = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } });
    const renamed = await prisma.investmentHolding.update({ where: { id: h.id }, data: { name: "Itaúsa PN", allocationClass: "br_stocks" } });
    const batchId = await recordMutation(prisma, USER, "update", null, [{ model: "InvestmentHolding", recordId: h.id, before: snapshot(before), after: snapshot(renamed) }]);
    await prisma.investmentHolding.update({ where: { id: h.id }, data: { currentPrice: 11.5, lastPriceUpdate: new Date() } });

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ name: "Itaúsa", allocationClass: null, currentPrice: 11.5 });
  });

  it("removes a holding the batch created once its operations are gone, and keeps one still in use", async () => {
    const records: MutationRecordInput[] = [];
    const fresh = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG Logística" }, prisma);
    records.push({ model: "InvestmentHolding", recordId: fresh.id, before: null, after: snapshot(fresh) });
    const buy = await recordOperation(USER, { holdingId: fresh.id, type: "buy", quantity: 10, pricePerUnit: 160, totalAmount: 1600, date: "2026-09-03" }, prisma, { collect: records });
    const shared = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "TAEE11", name: "Taesa" }, prisma);
    records.push({ model: "InvestmentHolding", recordId: shared.id, before: null, after: snapshot(shared) });
    await recordOperation(USER, { holdingId: shared.id, type: "buy", quantity: 4, pricePerUnit: 35, totalAmount: 140, date: "2026-09-03" }, prisma, { collect: records });
    const batchId = await recordMutation(prisma, USER, "create", "Aporte", records);
    // A later buy of the same asset, in a batch of its own.
    await recordOperation(USER, { holdingId: shared.id, type: "buy", quantity: 6, pricePerUnit: 36, totalAmount: 216, date: "2026-09-10" }, prisma);

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.investmentHolding.count({ where: { id: fresh.id } })).toBe(0);
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { id: buy.cashEntryId! } })).toBe(0);
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: shared.id } })).toMatchObject({ currentQuantity: 6, totalInvested: 216 });
  });

  it("re-creates a merged category and points its rows back at it", async () => {
    const from = await prisma.category.create({ data: { userId: USER, name: "Delivery", type: "expense", color: "pink" } });
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 40, description: "iFood", date: "2026-09-04", categoryId: from.id }, prisma);
    const created = await createRule(USER, { matchType: "contains", pattern: "ifood", categoryId: from.id }, prisma);
    const rule = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: created.id } });
    // What a recorded merge into Groceries writes: the rows moved, then the category deleted outright.
    const records: MutationRecordInput[] = [];
    await updateEntry(USER, e.entryIds[0], { categoryId: f.categories.Groceries }, prisma, { collect: records });
    const moved = await prisma.categorizationRule.update({ where: { id: rule.id }, data: { categoryId: f.categories.Groceries } });
    records.push({ model: "CategorizationRule", recordId: rule.id, before: snapshot(rule), after: snapshot(moved) });
    await prisma.category.delete({ where: { id: from.id } });
    records.push({ model: "Category", recordId: from.id, before: snapshot(from), after: null });
    const batchId = await recordMutation(prisma, USER, "merge", null, records);

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: from.id } })).toMatchObject({ userId: USER, name: "Delivery", color: "pink", createdAt: from.createdAt });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(from.id);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).categoryId).toBe(from.id);
  });

  it("removes accounts and categories the batch created unless other rows use them", async () => {
    const [usedCat, freeCat] = await Promise.all(["Pets", "Hobbies"].map((name) => prisma.category.create({ data: { userId: USER, name, type: "expense" } })));
    const [usedAcc, freeAcc] = await Promise.all(["Inter", "C6"].map((name) => prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name, currency: "BRL" } })));
    const records: MutationRecordInput[] = [
      ...[usedCat, freeCat].map((c) => ({ model: "Category" as const, recordId: c.id, before: null, after: snapshot(c) })),
      ...[usedAcc, freeAcc].map((a) => ({ model: "Account" as const, recordId: a.id, before: null, after: snapshot(a) })),
    ];
    const batchId = await recordMutation(prisma, USER, "create", null, records);
    const used = await createEntry(USER, { kind: "expense", accountId: usedAcc.id, categoryId: usedCat.id, amount: 80, description: "Ração", date: "2026-09-06" }, prisma);

    await undoBatch(USER, batchId, prisma);
    expect(await prisma.category.count({ where: { id: { in: [usedCat.id, freeCat.id] } } })).toBe(1);
    expect(await prisma.account.count({ where: { id: { in: [usedAcc.id, freeAcc.id] } } })).toBe(1);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: used.entryIds[0] } })).toMatchObject({ accountId: usedAcc.id, categoryId: usedCat.id });
  });

  it("restores and re-creates recurring rules and budgets (decimals, dates, null json)", async () => {
    const rule = await prisma.recurringRule.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: 59.9,
        currency: "BRL",
        description: "Spotify",
        categoryId: f.categories.Software,
        frequency: "monthly",
        startDate: new Date("2026-01-05"),
        nextDueDate: new Date("2026-10-05"),
      },
    });
    const budget = await prisma.budget.create({
      data: { userId: USER, categoryId: f.categories.Groceries, amount: 1200, currency: "BRL", period: "monthly", year: 2026, month: 9, effectiveFrom: new Date("2026-09-01") },
    });
    const edited = await prisma.recurringRule.update({ where: { id: rule.id }, data: { amount: 64.9, reminders: { daysBefore: 1 } } });
    await prisma.budget.delete({ where: { id: budget.id } });
    const batchId = await recordMutation(prisma, USER, "update", null, [
      { model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: snapshot(edited) },
      { model: "Budget", recordId: budget.id, before: snapshot(budget), after: null },
    ]);

    await undoBatch(USER, batchId, prisma);
    const back = await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(toNumber(back.amount)).toBe(59.9);
    expect(back.reminders).toBeNull();
    expect(back.nextDueDate).toEqual(rule.nextDueDate);
    const recreated = await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } });
    expect(recreated).toMatchObject({ userId: USER, entityId: null, month: 9, isTombstone: false, effectiveFrom: budget.effectiveFrom });
    expect(toNumber(recreated.amount)).toBe(1200);
  });
});

describe("batch source and listing", () => {
  it("attributes batches to the source in context, else to the user", async () => {
    const mine = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "a", date: "2026-09-01" }, prisma);
    const mcp = await withMutationSource("mcp", () => createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "b", date: "2026-09-01" }, prisma));
    const explicit = await withMutationSource("mcp", () => recordMutation(prisma, USER, "import", null, [], { source: "import" }));
    expect((await batchOf(mine.batchId!)).source).toBe("user");
    expect((await batchOf(mcp.batchId!)).source).toBe("mcp");
    expect((await batchOf(explicit)).source).toBe("import");
  });

  it("lists only what undo accepts now when undoable=true", async () => {
    const created = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    const updated = await updateEntry(USER, created.entryIds[0], { amount: 12 }, prisma);
    const other = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 3, description: "Pão", date: "2026-09-10" }, prisma);
    const deleted = await softDeleteEntries(USER, other.entryIds, prisma);
    await undoBatch(USER, deleted.batchId!, prisma);

    const all = await listBatches(USER, prisma);
    expect(all.map((b) => [b.id, b.undoable])).toEqual([
      [deleted.batchId, false],
      [other.batchId, true],
      [updated.batchId, true],
      [created.batchId, false],
    ]);
    expect(all[0]).toMatchObject({ op: "delete", source: "user", records: 1 });
    expect(all[0].undoneAt).toBeInstanceOf(Date);

    expect((await listBatches(USER, prisma, { undoable: true, limit: 1 })).map((b) => b.id)).toEqual([other.batchId]);
    await undoBatch(USER, updated.batchId!, prisma);
    expect((await listBatches(USER, prisma, { undoable: true })).map((b) => b.id)).toEqual([other.batchId, created.batchId]);
  });
});
