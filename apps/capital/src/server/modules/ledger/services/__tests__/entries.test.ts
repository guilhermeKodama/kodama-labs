import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "../../lib/money";
import {
  bulkUpdateEntries,
  createEntry,
  duplicateEntries,
  restoreEntries,
  softDeleteEntries,
  updateEntry,
} from "../entries";
import { undoBatch } from "../mutations";
import { learnRule } from "../rules";
import { markStatementPayment, statementMonthFor, unmarkStatementPayment } from "../statements";

const USER = "test-user-ledger-entries-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const entry = (id: string) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });

describe("createEntry", () => {
  it("books an expense as an outflow and converts to base with the user's rate", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, currency: "USD", description: "AWS", date: "2026-09-10" }, prisma);
    const e = await entry(r.entryIds[0]);
    expect(toNumber(e.amount)).toBe(-100);
    expect(toNumber(e.exchangeRate)).toBe(5);
    expect(toNumber(e.amountBase)).toBe(-500);
    expect(e.entityId).toBe(f.pfId);
    expect(e.effectiveDate.toISOString()).toBe(e.date.toISOString());
    expect(r.batchId).not.toBeNull();
  });

  it("puts card purchases on the statement that closes after the purchase", async () => {
    const before = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 50, description: "iFood", date: "2026-09-04" }, prisma);
    const after = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 50, description: "iFood", date: "2026-09-06" }, prisma);
    const a = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: before.entryIds[0] }, include: { cardStatement: true } });
    const b = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: after.entryIds[0] }, include: { cardStatement: true } });
    expect(a.cardStatement?.month).toBe("2026-09");
    expect(b.cardStatement?.month).toBe("2026-10");
    expect(a.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-05");
    expect(b.effectiveDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(statementMonthFor(new Date(Date.UTC(2026, 1, 28, 12)), 31)).toBe("2026-02");
  });

  it("splits installments across consecutive statements", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 1000, installments: 3, description: "Notebook", date: "2026-09-04" }, prisma);
    expect(r.entryIds).toHaveLength(3);
    const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: r.entryIds } }, include: { cardStatement: true }, orderBy: { installmentNumber: "asc" } });
    expect(rows.map((x) => toNumber(x.amount))).toEqual([-333.33, -333.33, -333.34]);
    expect(rows.map((x) => x.cardStatement?.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(rows[1].description).toBe("Notebook (2/3)");
    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { id: rows[0].installmentPlanId! } });
    expect(plan.totalInstallments).toBe(3);
  });

  it("creates a transfer as two balanced legs and infers the direction", async () => {
    const r = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 15000, date: "2026-09-20" }, prisma);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.transferGroupId! }, include: { legs: true } });
    expect(group.direction).toBe("profit_distribution");
    expect(group.legs.map((l) => toNumber(l.amount)).sort((a, b) => a - b)).toEqual([-15000, 15000]);
    expect(group.legs.every((l) => l.kind === "transfer")).toBe(true);
  });

  it("books reimbursement legs as expense so P&L moves between entities", async () => {
    const r = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 300, direction: "reimbursement", date: "2026-09-20" }, prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: r.transferGroupId! } });
    expect(legs.every((l) => l.kind === "expense")).toBe(true);
  });

  it("converts the destination leg when the accounts use different currencies", async () => {
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const r = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: usd.id, amount: 1000, date: "2026-09-20" }, prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: r.transferGroupId! } });
    const to = legs.find((l) => l.accountId === usd.id)!;
    expect(to.currency).toBe("USD");
    expect(toNumber(to.amount)).toBe(200);
    expect(legs.reduce((s, l) => s + toNumber(l.amountBase), 0)).toBeCloseTo(0, 4);
  });

  it("auto-categorizes from rules and counts the hit", async () => {
    const rule = await learnRule(USER, "Pão de Açúcar", f.categories.Groceries, "manual", prisma);
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 80, description: "pão de açúcar", date: "2026-09-10" }, prisma);
    const e = await entry(r.entryIds[0]);
    expect(e.categoryId).toBe(f.categories.Groceries);
    expect(e.isAutoCategorized).toBe(true);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule!.id } })).hitCount).toBe(1);
  });
});

describe("updates, trash and undo", () => {
  it("moves a card purchase to another statement when its date changes", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 50, description: "Uber", date: "2026-09-04" }, prisma);
    await updateEntry(USER, r.entryIds[0], { date: "2026-09-08", amount: 70 }, prisma);
    const e = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] }, include: { cardStatement: true } });
    expect(e.cardStatement?.month).toBe("2026-10");
    expect(toNumber(e.amount)).toBe(-70);
  });

  it("soft-deletes both legs of a transfer and restores them", async () => {
    const r = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 500, date: "2026-09-20" }, prisma);
    const del = await softDeleteEntries(USER, [r.entryIds[0]], prisma);
    expect(del.deleted).toBe(2);
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.transferGroupId! } })).deletedAt).not.toBeNull();
    await restoreEntries(USER, [r.entryIds[1]], prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: r.transferGroupId! } });
    expect(legs.every((l) => l.deletedAt === null)).toBe(true);
  });

  it("undoes a create, an update and a delete", async () => {
    const created = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    const id = created.entryIds[0];
    const updated = await updateEntry(USER, id, { description: "Café da manhã", amount: 12 }, prisma);
    await undoBatch(USER, updated.batchId!, prisma);
    let e = await entry(id);
    expect(e.description).toBe("Café");
    expect(toNumber(e.amount)).toBe(-10);

    const deleted = await softDeleteEntries(USER, [id], prisma);
    await undoBatch(USER, deleted.batchId!, prisma);
    e = await entry(id);
    expect(e.deletedAt).toBeNull();

    await undoBatch(USER, created.batchId!, prisma);
    expect(await prisma.ledgerEntry.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses to undo an older batch when a newer one touched the same row", async () => {
    const created = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    await updateEntry(USER, created.entryIds[0], { amount: 11 }, prisma);
    await expect(undoBatch(USER, created.batchId!, prisma)).rejects.toThrow(/newer change/);
  });

  it("bulk-updates category and learns a rule", async () => {
    const a = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Figma", date: "2026-09-10" }, prisma);
    const b = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 20, description: "Figma", date: "2026-09-11" }, prisma);
    const res = await bulkUpdateEntries(USER, [a.entryIds[0], b.entryIds[0]], { categoryId: f.categories.Software, toggleTaxDeductible: true }, prisma, { createRule: true });
    expect(res.changed).toBe(2);
    const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: [a.entryIds[0], b.entryIds[0]] } } });
    expect(rows.every((r) => r.categoryId === f.categories.Software && r.isTaxDeductible)).toBe(true);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "figma" } })).toBe(1);
    await undoBatch(USER, res.batchId!, prisma);
    const reverted = await prisma.ledgerEntry.findMany({ where: { id: { in: [a.entryIds[0], b.entryIds[0]] } } });
    expect(reverted.every((r) => r.categoryId === null && !r.isTaxDeductible)).toBe(true);
  });

  it("duplicates entries and transfers with fresh ids", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 100, date: "2026-09-20" }, prisma);
    const d = await duplicateEntries(USER, [t.entryIds[0]], prisma);
    expect(d.entryIds).toHaveLength(2);
    const copies = await prisma.ledgerEntry.findMany({ where: { id: { in: d.entryIds } } });
    expect(new Set(copies.map((c) => c.transferGroupId)).size).toBe(1);
    expect(copies[0].transferGroupId).not.toBe(t.transferGroupId);
    const original = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: t.entryIds[0] } });
    expect(copies.every((c) => c.description === `${original.description} (cópia)`)).toBe(true);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: copies[0].transferGroupId! } });
    expect(group.description).toMatch(/ \(cópia\)$/);
  });
});

describe("card payments", () => {
  it("turns an expense into a statement payment and back", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 200, description: "Mercado", date: "2026-09-02" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    const pay = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 200, description: "Pagamento Nubank", date: "2026-09-12" }, prisma);
    await markStatementPayment(USER, pay.entryIds[0], statement.id, prisma);
    const leg = await entry(pay.entryIds[0]);
    expect(leg.kind).toBe("transfer");
    const card = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: leg.transferGroupId!, accountId: f.card } });
    expect(toNumber(card.amount)).toBe(200);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(leg.transferGroupId);

    await unmarkStatementPayment(USER, pay.entryIds[0], prisma);
    const back = await entry(pay.entryIds[0]);
    expect(back.kind).toBe("expense");
    expect(back.transferGroupId).toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { accountId: f.card, kind: "transfer" } })).toBe(0);
  });

  it("links a card_payment transfer to the open statement", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 90, description: "Uber", date: "2026-09-02" }, prisma);
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.card, amount: 90, date: "2026-09-12" }, prisma);
    const stmt = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    expect(stmt.paymentGroupId).toBe(t.transferGroupId);
  });
});
