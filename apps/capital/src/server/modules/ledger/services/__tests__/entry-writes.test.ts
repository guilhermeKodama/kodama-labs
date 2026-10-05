import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { toNumber } from "../../lib/money";
import { bulkUpdateEntries, createEntry, previewBulkUpdate, updateEntry } from "../entries";
import { undoBatch } from "../mutations";
import { learnRule } from "../rules";

const USER = "test-user-s2-entry-writes-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const entry = (id: string) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
const group = (id: string) => prisma.transferGroup.findUniqueOrThrow({ where: { id }, include: { legs: true } });

async function transfer(fromAccountId: string, toAccountId: string, amount = 1000) {
  const t = await createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date: "2026-09-20" }, prisma);
  const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: t.transferGroupId! } });
  return { groupId: t.transferGroupId!, from: legs.find((l) => toNumber(l.amount) < 0)!, to: legs.find((l) => toNumber(l.amount) > 0)! };
}

describe("PATCH kind", () => {
  it("turns an expense into income keeping the amount, drops an expense category, and undoes", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, description: "Reembolso", date: "2026-09-10", categoryId: f.categories.Groceries }, prisma);
    const id = r.entryIds[0];
    const res = await updateEntry(USER, id, { kind: "income" }, prisma);
    expect(res.entry).toMatchObject({ kind: "income", amount: 300, amountBase: 300, categoryId: null });
    await updateEntry(USER, id, { kind: "expense", categoryId: f.categories.Software }, prisma);
    expect(await entry(id)).toMatchObject({ kind: "expense", categoryId: f.categories.Software });
    expect(toNumber((await entry(id)).amount)).toBe(-300);
    await undoBatch(USER, (await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER }, orderBy: { createdAt: "desc" } })).id, prisma);
    await undoBatch(USER, res.batchId!, prisma);
    const back = await entry(id);
    expect(back).toMatchObject({ kind: "expense", categoryId: f.categories.Groceries });
    expect(toNumber(back.amount)).toBe(-300);
  });

  it("keeps an income category when it changes nothing about the type", async () => {
    const r = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 5000, description: "Salário", date: "2026-09-05", categoryId: f.categories.Salary }, prisma);
    const res = await updateEntry(USER, r.entryIds[0], { kind: "income", amount: 5100 }, prisma);
    expect(res.entry).toMatchObject({ kind: "income", amount: 5100, categoryId: f.categories.Salary });
  });

  it("refuses to change the type of an operation's cash leg or to give a simple entry endpoints", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itaú" }, prisma);
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 50, date: "2026-09-10" }, prisma);
    await expect(updateEntry(USER, div.cashEntryId!, { kind: "expense" }, prisma)).rejects.toMatchObject({ code: "entry.kind_locked", status: 422 });
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    await expect(updateEntry(USER, r.entryIds[0], { toAccountId: f.pjChecking }, prisma)).rejects.toMatchObject({ code: "entry.not_transfer" });
  });
});

describe("PATCH transfer endpoints", () => {
  it("moves both endpoints at once and re-infers the direction; undo puts them back", async () => {
    const t = await transfer(f.pfChecking, f.pjChecking);
    expect((await group(t.groupId)).direction).toBe("capital_injection");
    const res = await updateEntry(USER, t.to.id, { fromAccountId: f.pjChecking, toAccountId: f.pfChecking }, prisma);
    const g = await group(t.groupId);
    expect(g.direction).toBe("profit_distribution");
    const from = g.legs.find((l) => toNumber(l.amount) < 0)!;
    const to = g.legs.find((l) => toNumber(l.amount) > 0)!;
    expect(from).toMatchObject({ accountId: f.pjChecking, entityId: f.pjId });
    expect(to).toMatchObject({ accountId: f.pfChecking, entityId: f.pfId });
    expect(g.legs.reduce((s, l) => s + toNumber(l.amountBase), 0)).toBeCloseTo(0, 4);

    await undoBatch(USER, res.batchId!, prisma);
    const back = await group(t.groupId);
    expect(back.direction).toBe("capital_injection");
    expect(back.legs.find((l) => l.id === t.from.id)).toMatchObject({ accountId: f.pfChecking });
  });

  it("keeps a direction set by hand when an endpoint moves, and refuses a transfer to itself", async () => {
    const t = await transfer(f.pjChecking, f.pfChecking);
    await updateEntry(USER, t.from.id, { direction: "between_accounts" }, prisma);
    const second = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Inter", currency: "BRL" } });
    await updateEntry(USER, t.from.id, { toAccountId: second.id }, prisma);
    expect((await group(t.groupId)).direction).toBe("between_accounts");
    await expect(updateEntry(USER, t.from.id, { fromAccountId: second.id }, prisma)).rejects.toMatchObject({ code: "transfer.same_account" });
  });

  it("toggles a reimbursement: expense legs, then back to a profit distribution with transfer legs", async () => {
    const t = await transfer(f.pjChecking, f.pfChecking, 300);
    await updateEntry(USER, t.from.id, { reimbursement: true }, prisma);
    let g = await group(t.groupId);
    expect(g.direction).toBe("reimbursement");
    expect(g.legs.every((l) => l.kind === "expense")).toBe(true);
    await updateEntry(USER, t.from.id, { categoryId: f.categories.Software }, prisma);

    const res = await updateEntry(USER, t.from.id, { reimbursement: false }, prisma);
    g = await group(t.groupId);
    expect(g.direction).toBe("profit_distribution");
    expect(g.legs.every((l) => l.kind === "transfer" && l.categoryId === null)).toBe(true);
    await undoBatch(USER, res.batchId!, prisma);
    g = await group(t.groupId);
    expect(g.direction).toBe("reimbursement");
    expect(g.legs.find((l) => l.id === t.from.id)).toMatchObject({ kind: "expense", categoryId: f.categories.Software });
  });

  it("re-expresses a leg moved to an account in another currency, keeping the group balanced", async () => {
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const t = await transfer(f.pfChecking, f.broker, 1000);
    await updateEntry(USER, t.from.id, { toAccountId: usd.id }, prisma);
    const to = await entry(t.to.id);
    expect(to).toMatchObject({ accountId: usd.id, currency: "USD" });
    expect(toNumber(to.amount)).toBe(200);
    expect(toNumber(to.amountBase)).toBe(1000);
  });

  it("moves the bill payment off the statement when it stops being a card payment; undo links it again", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 90, description: "Uber", date: "2026-09-02" }, prisma);
    const t = await transfer(f.pfChecking, f.card, 90);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    expect(statement.paymentGroupId).toBe(t.groupId);
    const res = await updateEntry(USER, t.from.id, { toAccountId: f.pjChecking }, prisma);
    expect((await group(t.groupId)).direction).toBe("capital_injection");
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBeNull();
    await undoBatch(USER, res.batchId!, prisma);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(t.groupId);
  });
});

describe("categorization rule on create", () => {
  it("records which rule chose the category", async () => {
    const rule = (await learnRule(USER, "Netflix", f.categories.Software, "manual", prisma))!;
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 55.9, description: "Netflix", date: "2026-09-10" }, prisma);
    expect(await entry(r.entryIds[0])).toMatchObject({ categoryId: f.categories.Software, categorizedByRuleId: rule.id, isAutoCategorized: true });
    const manual = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 55.9, description: "Netflix", date: "2026-09-11", categoryId: f.categories.Groceries }, prisma);
    expect(await entry(manual.entryIds[0])).toMatchObject({ categorizedByRuleId: null, isAutoCategorized: false });
  });
});

describe("installment undo", () => {
  it("removes the plan along with its parcels", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 600, installments: 3, description: "Cadeira", date: "2026-09-04" }, prisma);
    const planId = (await entry(r.entryIds[0])).installmentPlanId!;
    await undoBatch(USER, r.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: r.entryIds } } })).toBe(0);
    expect(await prisma.installmentPlan.count({ where: { id: planId } })).toBe(0);
  });
});

describe("bulk", () => {
  async function selection() {
    const a = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Figma", date: "2026-09-10" }, prisma);
    const b = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 20, description: "Figma", date: "2026-09-11", categoryId: f.categories.Software }, prisma);
    const t = await transfer(f.pfChecking, f.broker, 500);
    return { a: a.entryIds[0], b: b.entryIds[0], legs: [t.from.id, t.to.id], ids: [a.entryIds[0], b.entryIds[0], t.from.id, t.to.id] };
  }

  it("dry-runs: counts rows (a transfer once), changes per field and rules it would learn, writing nothing", async () => {
    const s = await selection();
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const preview = await previewBulkUpdate(USER, s.ids, { categoryId: f.categories.Software, entityId: f.pjId, toggleTaxDeductible: true }, prisma, { createRule: true });
    expect(preview).toEqual({
      matched: 3,
      changed: 3,
      byField: {
        categoryId: { changed: 1, unchanged: 2 },
        entityId: { changed: 2, unchanged: 1 },
        isTaxDeductible: { changed: 3, unchanged: 0 },
      },
      rulesLearned: 1,
    });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
    expect((await entry(s.a)).entityId).toBe(f.pfId);
  });

  it("moves entries to another entity but leaves transfer legs where they are", async () => {
    const s = await selection();
    const preview = await previewBulkUpdate(USER, s.ids, { entityId: f.pjId }, prisma);
    expect(preview).toMatchObject({ matched: 3, changed: 2, byField: { entityId: { changed: 2, unchanged: 1 } } });
    const res = await bulkUpdateEntries(USER, s.ids, { entityId: f.pjId }, prisma);
    expect(res).toMatchObject({ changed: 2, matched: 3, rulesLearned: 0 });
    expect(await entry(s.a)).toMatchObject({ entityId: f.pjId, accountId: f.pjChecking });
    const legs = await prisma.ledgerEntry.findMany({ where: { id: { in: s.legs } } });
    expect(legs.every((l) => l.entityId === f.pfId)).toBe(true);
    const records = await prisma.mutationRecord.findMany({ where: { batchId: res.batchId! } });
    expect(records.map((r) => r.recordId).sort()).toEqual([s.a, s.b].sort());
  });

  it("counts the rules a real run learns", async () => {
    const s = await selection();
    const res = await bulkUpdateEntries(USER, [s.a, s.b], { categoryId: f.categories.Groceries }, prisma, { createRule: true });
    expect(res).toMatchObject({ changed: 2, rulesLearned: 1 });
  });
});
