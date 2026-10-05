import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, deleteOperation, recordOperation, updateOperation } from "@capital/server/modules/investments/services/portfolio";
import { toNumber } from "../../lib/money";
import { createEntry, softDeleteEntries, updateEntry } from "../entries";
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
