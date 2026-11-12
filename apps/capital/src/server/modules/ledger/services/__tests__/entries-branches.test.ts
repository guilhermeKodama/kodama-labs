import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import type { Account, Entity } from "@/generated/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { toNumber } from "../../lib/money";
import {
  bulkUpdateEntries,
  createEntry,
  duplicateEntries,
  getEntry,
  inferDirection,
  previewBulkUpdate,
  purgeTrash,
  restoreEntries,
  softDeleteEntries,
  trashRowCount,
  updateEntry,
} from "../entries";
import { undoBatch, type MutationRecordInput } from "../mutations";

const USER = "test-user-ledger-entries-branches-001";
const OTHER = "test-user-ledger-entries-branches-002";
const EURO = "test-user-ledger-entries-branches-003";
let f: LedgerFixture;
let o: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    usdRate: 0.2,
    categories: [
      { name: "Groceries", type: "expense" },
      { name: "Software", type: "expense" },
      { name: "Salary", type: "income" },
      { name: "Bonus", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
  await deleteLedgerFixture(prisma, EURO);
});

const row = (id: string) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
const expense = (overrides: Record<string, unknown> = {}, opts: Parameters<typeof createEntry>[3] = {}) =>
  createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, date: "2026-09-10", description: "Compra", ...overrides } as never, prisma, opts);
const income = (overrides: Record<string, unknown> = {}) =>
  createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 100, date: "2026-09-10", description: "Venda", ...overrides } as never, prisma);
const transferOf = (from: string, to: string, amount: number, extra: Record<string, unknown> = {}) =>
  createEntry(USER, { kind: "transfer", fromAccountId: from, toAccountId: to, amount, date: "2026-09-20", ...extra } as never, prisma);
const legs = async (groupId: string) => {
  const rows = await prisma.ledgerEntry.findMany({ where: { transferGroupId: groupId } });
  return { from: rows.find((r) => toNumber(r.amount) < 0)!, to: rows.find((r) => toNumber(r.amount) > 0)!, all: rows };
};
async function usdAccount(name = "Avenue") {
  return prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name, currency: "USD" } });
}

/** A user whose base is the euro, with a BRL and a USD account: neither is the base currency. */
async function euroUser() {
  const e = await createLedgerFixture(prisma, EURO, { baseCurrency: "EUR" });
  await prisma.currency.createMany({
    data: [
      { userId: EURO, code: "BRL", name: "Real", symbol: "R$", manualRate: 5 },
      { userId: EURO, code: "USD", name: "Dollar", symbol: "$", manualRate: 1.25 },
    ],
  });
  const brl = await prisma.account.create({ data: { userId: EURO, entityId: e.pfId, type: "checking", name: "Real", currency: "BRL" } });
  const usd = await prisma.account.create({ data: { userId: EURO, entityId: e.pfId, type: "brokerage", name: "Dollar", currency: "USD" } });
  return { ...e, brl, usd };
}

describe("inferDirection", () => {
  const entity = (kind: "personal" | "business", id: string) => ({ id, kind }) as Entity;
  const acct = (type: Account["type"], entityId: string, kind: "personal" | "business") =>
    ({ id: `${type}-${entityId}`, type, entityId, entity: entity(kind, entityId) }) as Account & { entity: Entity };

  it("reads the direction off the account types and entities", () => {
    expect(inferDirection(acct("checking", "pf", "personal"), acct("credit_card", "pf", "personal"))).toBe("card_payment");
    expect(inferDirection(acct("checking", "pf", "personal"), acct("brokerage", "pf", "personal"))).toBe("investment_deposit");
    expect(inferDirection(acct("brokerage", "pf", "personal"), acct("checking", "pf", "personal"))).toBe("investment_withdrawal");
    expect(inferDirection(acct("brokerage", "pf", "personal"), acct("brokerage", "pf", "personal"))).toBe("between_accounts");
    expect(inferDirection(acct("checking", "pj", "business"), acct("checking", "pf", "personal"))).toBe("profit_distribution");
    expect(inferDirection(acct("checking", "pf", "personal"), acct("checking", "pj", "business"))).toBe("capital_injection");
    expect(inferDirection(acct("checking", "pj", "business"), acct("checking", "pj2", "business"))).toBe("between_accounts");
    expect(inferDirection(acct("checking", "pf", "personal"), acct("checking", "pf", "personal"))).toBe("between_accounts");
  });
});

describe("createEntry: categories, reimbursements and accounts", () => {
  it("refuses a category that is missing, someone else's or archived", async () => {
    await expect(expense({ categoryId: "nope" })).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(expense({ categoryId: o.categories.Groceries })).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await prisma.category.update({ where: { id: f.categories.Groceries }, data: { isArchived: true } });
    await expect(expense({ categoryId: f.categories.Groceries })).rejects.toMatchObject({ status: 422, code: "category.archived", params: { name: "Groceries" } });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(0);
  });

  it("lets an income point at an expense category it reimburses, and nothing else", async () => {
    const ok = await income({ reimbursesCategoryId: f.categories.Groceries });
    expect((await row(ok.entryIds[0])).reimbursesCategoryId).toBe(f.categories.Groceries);
    await expect(expense({ reimbursesCategoryId: f.categories.Groceries })).rejects.toMatchObject({ status: 422, code: "entry.reimbursement_income_only" });
    await expect(income({ reimbursesCategoryId: f.categories.Salary })).rejects.toMatchObject({ status: 422, code: "entry.reimbursement_expense_category" });
    await expect(income({ reimbursesCategoryId: "nope" })).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    const none = await income({ reimbursesCategoryId: null });
    expect((await row(none.entryIds[0])).reimbursesCategoryId).toBeNull();
  });

  it("refuses an archived account and one that is not the user's", async () => {
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await expect(expense({ accountId: f.broker })).rejects.toMatchObject({ status: 422, code: "account.archived", params: { name: "XP" } });
    await expect(expense({ accountId: o.pfChecking })).rejects.toMatchObject({ status: 404, code: "account.not_found" });
  });
});

describe("createEntry: options", () => {
  it("books a card purchase on the statement month it is told to, and shifts installments from there across the year end", async () => {
    const single = await expense({ accountId: f.card }, { statementMonth: "2026-12" });
    const s = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: single.entryIds[0] }, include: { cardStatement: true } });
    expect(s.cardStatement?.month).toBe("2026-12");
    expect(s.effectiveDate.toISOString().slice(0, 10)).toBe("2026-12-05");

    const split = await expense({ accountId: f.card, amount: 300, installments: 3, description: "TV" }, { statementMonth: "2026-12" });
    const parcels = await prisma.ledgerEntry.findMany({ where: { id: { in: split.entryIds } }, include: { cardStatement: true }, orderBy: { installmentNumber: "asc" } });
    expect(parcels.map((p) => p.cardStatement?.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(parcels.map((p) => p.description)).toEqual(["TV (1/3)", "TV (2/3)", "TV (3/3)"]);
    expect(parcels.map((p) => p.date.toISOString().slice(0, 10))).toEqual(["2026-09-10", "2026-10-10", "2026-11-10"]);
  });

  it("files a purchase on a card with no closing day under closing day 1", async () => {
    await prisma.account.update({ where: { id: f.card }, data: { closingDay: null } });
    const r = await expense({ accountId: f.card, date: "2026-09-10" });
    const e = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] }, include: { cardStatement: true } });
    expect(e.cardStatement?.month).toBe("2026-10");
    expect(e.effectiveDate.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("stores the writer's extras: merchant, metadata, notes, tax flag, external id (first parcel only), kind override", async () => {
    const r = await expense(
      { amount: 90, notes: "nota", isTaxDeductible: true, externalId: "ext-9", installments: 2, accountId: f.card },
      { merchantName: "Loja X", metadata: { origin: "test" }, kind: "investment" }
    );
    const [a, b] = await prisma.ledgerEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { installmentNumber: "asc" } });
    expect(a).toMatchObject({ kind: "investment", merchantName: "Loja X", notes: "nota", isTaxDeductible: true, externalId: "ext-9", metadata: { origin: "test" } });
    expect(b.externalId).toBeNull();
    expect(toNumber(a.amount)).toBe(-45);
  });

  it("tags the entry with the recurring rule and import that produced it", async () => {
    const rule = await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 10, currency: "BRL", description: "Aluguel", frequency: "monthly", startDate: new Date("2026-09-01T12:00:00Z"), nextDueDate: new Date("2026-10-01T12:00:00Z") },
    });
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 1 } });
    const r = await expense({}, { recurringRuleId: rule.id, importId: imp.id });
    expect(await row(r.entryIds[0])).toMatchObject({ recurringRuleId: rule.id, importId: imp.id });
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-09-20" }, prisma, { recurringRuleId: rule.id, importId: imp.id, metadata: { src: "rule" } });
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } });
    expect(group).toMatchObject({ recurringRuleId: rule.id, importId: imp.id });
    expect((await legs(t.transferGroupId!)).all.every((l) => l.recurringRuleId === rule.id && l.importId === imp.id)).toBe(true);
  });

  it("can skip the undo log, or hand its records to the caller", async () => {
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const silent = await expense({}, { record: false });
    expect(silent.batchId).toBeNull();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);

    const collect: MutationRecordInput[] = [];
    const collected = await expense({ amount: 60, installments: 2, accountId: f.card }, { collect });
    expect(collected.batchId).toBeNull();
    expect(collect.map((r) => r.model)).toEqual(["InstallmentPlan", "LedgerEntry", "LedgerEntry"]);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
  });

  it("keeps the rule that chose the category only while the category is the rule's choice", async () => {
    const rule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: f.categories.Software } });
    const given = await expense({ categoryId: f.categories.Groceries, description: "Uber" }, { categorizedByRuleId: rule.id, isAutoCategorized: true });
    expect(await row(given.entryIds[0])).toMatchObject({ categoryId: f.categories.Groceries, categorizedByRuleId: rule.id, isAutoCategorized: true });
    const matched = await expense({ description: "Uber trip" });
    expect(await row(matched.entryIds[0])).toMatchObject({ categoryId: f.categories.Software, categorizedByRuleId: rule.id, isAutoCategorized: true });
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).hitCount).toBe(1);
    const skipped = await expense({ description: "Uber trip" }, { skipRules: true, categorizedByRuleId: rule.id });
    expect(await row(skipped.entryIds[0])).toMatchObject({ categoryId: null, categorizedByRuleId: null, isAutoCategorized: false });
  });

  it("does not apply a rule limited to another entity", async () => {
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "contador", categoryId: f.categories.Software, entityId: f.pjId } });
    const pf = await expense({ description: "Contador" });
    expect((await row(pf.entryIds[0])).categoryId).toBeNull();
    const pj = await expense({ description: "Contador", accountId: f.pjChecking });
    expect((await row(pj.entryIds[0])).categoryId).toBe(f.categories.Software);
  });
});

describe("createEntry: transfers", () => {
  it("refuses the same account twice and accounts that are missing, archived or someone else's", async () => {
    await expect(transferOf(f.pfChecking, f.pfChecking, 10)).rejects.toMatchObject({ status: 422, code: "transfer.same_account" });
    await expect(transferOf(o.pfChecking, f.pfChecking, 10)).rejects.toMatchObject({ status: 404, code: "transfer.from_account_not_found" });
    await expect(transferOf(f.pfChecking, o.pfChecking, 10)).rejects.toMatchObject({ status: 404, code: "transfer.to_account_not_found" });
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await expect(transferOf(f.pfChecking, f.broker, 10)).rejects.toMatchObject({ status: 422, code: "account.archived" });
    await expect(transferOf(f.broker, f.pfChecking, 10)).rejects.toMatchObject({ status: 422, code: "account.archived" });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("infers each direction from the accounts and names the transfer after it in the user's language", async () => {
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    const cases: [string, string, string][] = [
      [f.pfChecking, f.card, "card_payment"],
      [f.pfChecking, f.broker, "investment_deposit"],
      [f.broker, f.pfChecking, "investment_withdrawal"],
      [f.pfChecking, f.pjChecking, "capital_injection"],
      [f.pfChecking, savings.id, "between_accounts"],
    ];
    for (const [from, to, direction] of cases) {
      const r = await transferOf(from, to, 25);
      const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.transferGroupId! } });
      expect(group.direction).toBe(direction);
      expect(group.description).toEqual(expect.stringContaining("→"));
    }
    const named = await transferOf(f.pfChecking, savings.id, 25);
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: named.transferGroupId! } })).description).toContain("Reserva");
    const custom = await transferOf(f.pfChecking, savings.id, 25, { description: "Meu nome", notes: "n" });
    expect((await legs(custom.transferGroupId!)).all.every((l) => l.description === "Meu nome" && l.notes === "n")).toBe(true);
  });

  it("books a same-currency transfer with a received amount different from the sent one", async () => {
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    const r = await transferOf(f.pfChecking, savings.id, 100, { toAmount: 80 });
    const { from, to } = await legs(r.transferGroupId!);
    expect(toNumber(from.amount)).toBe(-100);
    expect(toNumber(to.amount)).toBe(80);
    expect(toNumber(to.exchangeRate)).toBe(1.25);
    expect(toNumber(from.amountBase)).toBe(-100);
    expect(toNumber(to.amountBase)).toBe(100);
  });

  it("keeps the source rate when the received amount between same-currency accounts rounds to zero", async () => {
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    const r = await transferOf(f.pfChecking, savings.id, 100, { toAmount: 0.00001 });
    const { all } = await legs(r.transferGroupId!);
    const from = all.find((l) => l.accountId === f.pfChecking)!;
    const to = all.find((l) => l.accountId === savings.id)!;
    expect(toNumber(from.amount)).toBe(-100);
    expect(toNumber(to.amount)).toBe(0);
    expect(toNumber(to.exchangeRate)).toBe(toNumber(from.exchangeRate));
  });

  it("uses the caller's rate between two accounts in the same currency", async () => {
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    const r = await transferOf(f.pfChecking, savings.id, 100, { exchangeRate: 2 });
    const { from } = await legs(r.transferGroupId!);
    expect(toNumber(from.exchangeRate)).toBe(2);
    expect(toNumber(from.amountBase)).toBe(-100);
  });

  it("refuses an amount in a currency neither account uses", async () => {
    const usd = await usdAccount();
    await expect(transferOf(f.pfChecking, usd.id, 100, { currency: "EUR", exchangeRate: 5 })).rejects.toMatchObject({ status: 422, code: "transfer.fx_required" });
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    await expect(transferOf(f.pfChecking, savings.id, 100, { currency: "USD" })).rejects.toMatchObject({ status: 422, code: "transfer.fx_required" });
  });

  it("converts an amount stated in the destination currency into the source leg", async () => {
    const usd = await usdAccount();
    const r = await transferOf(f.pfChecking, usd.id, 100, { currency: "USD" });
    const { from, to } = await legs(r.transferGroupId!);
    expect(toNumber(to.amount)).toBe(100);
    expect(toNumber(from.amount)).toBeLessThan(-300); // 100 USD at ~5 BRL (dated rate or today's)
    expect(toNumber(from.amountBase) + toNumber(to.amountBase)).toBe(0);
    expect(toNumber(to.amountBase)).toBe(-toNumber(from.amountBase));
  });

  it("books the received amount in the destination currency when it is given along with the stated one", async () => {
    const usd = await usdAccount();
    const r = await transferOf(f.pfChecking, usd.id, 999, { currency: "USD", toAmount: 40 });
    const { from, to } = await legs(r.transferGroupId!);
    expect(toNumber(to.amount)).toBe(40);
    // The stated 999 is ignored: the source leg is the 40 USD received, at the rate the destination leg carries.
    expect(toNumber(from.amount)).toBeCloseTo(-40 * toNumber(to.exchangeRate), 2);
    expect(toNumber(from.exchangeRate)).toBe(1);
    expect(toNumber(from.amountBase)).toBe(toNumber(from.amount));
    expect(toNumber(to.amountBase)).toBe(-toNumber(from.amountBase));
  });

  it("pairs two foreign currencies at their quoted rates when neither is the base", async () => {
    // A euro-based user: dated rates are only used for BRL, so the quotes are today's and exact.
    const e = await euroUser();
    const r = await createEntry(EURO, { kind: "transfer", fromAccountId: e.brl.id, toAccountId: e.usd.id, amount: 100, date: "2026-09-20" }, prisma);
    const { from, to } = await legs(r.transferGroupId!);
    expect(toNumber(from.amount)).toBe(-100);
    expect(toNumber(to.amount)).toBe(25); // 100 BRL = 20 EUR = 25 USD
    expect(toNumber(from.exchangeRate)).toBe(0.2);
    expect(toNumber(to.exchangeRate)).toBe(0.8);
    expect(toNumber(from.amountBase)).toBe(-20);
    expect(toNumber(to.amountBase)).toBe(20);
  });

  it("rejects a received amount that rounds to zero", async () => {
    const usd = await usdAccount();
    await expect(transferOf(f.pfChecking, usd.id, 100, { toAmount: 0.001 })).rejects.toMatchObject({ status: 422, code: "transfer.fx_required" });
  });
});

describe("updateEntry: simple entries", () => {
  it("404s on a missing entry, another user's or a trashed one", async () => {
    const r = await expense();
    await expect(updateEntry(USER, "nope", { notes: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    await expect(updateEntry(OTHER, r.entryIds[0], { notes: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    await softDeleteEntries(USER, r.entryIds, prisma);
    await expect(updateEntry(USER, r.entryIds[0], { notes: "x" }, prisma)).rejects.toMatchObject({ code: "entry.not_found" });
  });

  it("edits text fields, amount, currency and tax flag, converting at today's rate unless one is given", async () => {
    const r = await expense({ amount: 100 });
    const id = r.entryIds[0];
    const edited = await updateEntry(USER, id, { description: "Nova", notes: "obs", isTaxDeductible: true, amount: 50 }, prisma);
    expect(edited.entry).toMatchObject({ description: "Nova", notes: "obs", isTaxDeductible: true, amount: -50 });
    const usd = await updateEntry(USER, id, { currency: "USD" }, prisma);
    expect(toNumber(usd.raw.exchangeRate)).toBe(5);
    expect(toNumber(usd.raw.amountBase)).toBe(-250);
    const explicit = await updateEntry(USER, id, { exchangeRate: 6 }, prisma);
    expect(toNumber(explicit.raw.amountBase)).toBe(-300);
    // Same currency again keeps the stored rate.
    const same = await updateEntry(USER, id, { currency: "USD", amount: 10 }, prisma);
    expect(toNumber(same.raw.amountBase)).toBe(-60);
  });

  it("moves an entry to another account or, given only an entity, to that entity's main account", async () => {
    const r = await expense();
    const toBroker = await updateEntry(USER, r.entryIds[0], { accountId: f.broker }, prisma);
    expect(toBroker.raw).toMatchObject({ accountId: f.broker, entityId: f.pfId });
    const toPj = await updateEntry(USER, r.entryIds[0], { entityId: f.pjId }, prisma);
    expect(toPj.raw).toMatchObject({ accountId: f.pjChecking, entityId: f.pjId });
    // Naming the entity it is already on moves nothing.
    const stays = await updateEntry(USER, r.entryIds[0], { entityId: f.pjId }, prisma);
    expect(stays.raw.accountId).toBe(f.pjChecking);
    await expect(updateEntry(USER, r.entryIds[0], { entityId: o.pfId }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    await expect(updateEntry(USER, r.entryIds[0], { accountId: o.pfChecking }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await expect(updateEntry(USER, r.entryIds[0], { accountId: f.broker }, prisma)).rejects.toMatchObject({ status: 422, code: "account.archived" });
  });

  it("puts a purchase moved onto a card on that card's statement, and off it when moved away", async () => {
    const r = await expense({ date: "2026-09-10" });
    const onCard = await updateEntry(USER, r.entryIds[0], { accountId: f.card }, prisma);
    expect(onCard.raw.cardStatementId).not.toBeNull();
    expect(onCard.raw.effectiveDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    const off = await updateEntry(USER, r.entryIds[0], { accountId: f.pfChecking }, prisma);
    expect(off.raw.cardStatementId).toBeNull();
    expect(off.raw.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("checks a new category against the entry's type, archived or not, unless told not to", async () => {
    const e = await expense();
    const id = e.entryIds[0];
    await expect(updateEntry(USER, id, { categoryId: f.categories.Salary }, prisma)).rejects.toMatchObject({ status: 422, code: "category.type_mismatch", params: { from: "income", to: "expense" } });
    await expect(updateEntry(USER, id, { categoryId: o.categories.Groceries }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    const ok = await updateEntry(USER, id, { categoryId: f.categories.Groceries }, prisma);
    expect(ok.raw).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: false, categorizedByRuleId: null });
    const imported = await updateEntry(USER, id, { categoryId: f.categories.Salary }, prisma, { checkCategoryType: false });
    expect(imported.raw.categoryId).toBe(f.categories.Salary);
    // Re-sending the category it already has is not checked and changes nothing.
    const again = await updateEntry(USER, id, { categoryId: f.categories.Salary, notes: "x" }, prisma);
    expect(again.raw.categoryId).toBe(f.categories.Salary);
    const cleared = await updateEntry(USER, id, { categoryId: null }, prisma);
    expect(cleared.raw.categoryId).toBeNull();
    const i = await income();
    await expect(updateEntry(USER, i.entryIds[0], { categoryId: f.categories.Groceries }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "category.type_mismatch",
      message: expect.stringContaining("an income"),
      params: { from: "expense", to: "income" },
    });
  });

  it("flips an income into an expense, dropping an income category and clearing a reimbursement", async () => {
    const reimb = await income({ categoryId: f.categories.Salary, reimbursesCategoryId: f.categories.Groceries });
    const flipped = await updateEntry(USER, reimb.entryIds[0], { kind: "expense" }, prisma);
    expect(flipped.raw).toMatchObject({ kind: "expense", categoryId: null, reimbursesCategoryId: null });
    expect(toNumber(flipped.raw.amount)).toBe(-100);
    // A new category of the new type goes through the type check.
    const back = await updateEntry(USER, reimb.entryIds[0], { kind: "income", categoryId: f.categories.Bonus }, prisma);
    expect(back.raw.categoryId).toBe(f.categories.Bonus);
    await expect(updateEntry(USER, reimb.entryIds[0], { kind: "expense", categoryId: f.categories.Bonus }, prisma)).rejects.toMatchObject({ code: "category.type_mismatch" });
  });

  it("sets and clears the expense category an income reimburses, and refuses it on an expense", async () => {
    const i = await income();
    const set = await updateEntry(USER, i.entryIds[0], { reimbursesCategoryId: f.categories.Software }, prisma);
    expect(set.raw.reimbursesCategoryId).toBe(f.categories.Software);
    const cleared = await updateEntry(USER, i.entryIds[0], { reimbursesCategoryId: null }, prisma);
    expect(cleared.raw.reimbursesCategoryId).toBeNull();
    await expect(updateEntry(USER, i.entryIds[0], { reimbursesCategoryId: f.categories.Salary }, prisma)).rejects.toMatchObject({ code: "entry.reimbursement_expense_category" });
    const e = await expense();
    await expect(updateEntry(USER, e.entryIds[0], { reimbursesCategoryId: f.categories.Groceries }, prisma)).rejects.toMatchObject({ status: 422, code: "entry.reimbursement_income_only" });
  });

  it("locks an investment operation's cash leg after a manual edit so a sync does not overwrite it", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itau" }, prisma);
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 50, date: "2026-09-10" }, prisma);
    expect((await prisma.investmentOperation.findFirstOrThrow({ where: { cashEntryId: div.cashEntryId! } })).syncLocked).toBe(false);
    await updateEntry(USER, div.cashEntryId!, { notes: "ajustado" }, prisma);
    expect((await prisma.investmentOperation.findFirstOrThrow({ where: { cashEntryId: div.cashEntryId! } })).syncLocked).toBe(true);
  });

  it("can skip the undo log or hand its records to the caller", async () => {
    const e = await expense();
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    expect((await updateEntry(USER, e.entryIds[0], { notes: "a" }, prisma, { record: false })).batchId).toBeNull();
    const collect: MutationRecordInput[] = [];
    expect((await updateEntry(USER, e.entryIds[0], { notes: "b" }, prisma, { collect })).batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
  });
});

describe("updateEntry: transfers", () => {
  const savingsOf = () => prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });

  it("refuses a reimbursement category and a type change on a transfer leg", async () => {
    const t = await transferOf(f.pfChecking, f.broker, 100);
    const { from } = await legs(t.transferGroupId!);
    await expect(updateEntry(USER, from.id, { reimbursesCategoryId: f.categories.Groceries }, prisma)).rejects.toMatchObject({ code: "entry.reimbursement_income_only" });
    await expect(updateEntry(USER, from.id, { kind: "income" }, prisma)).rejects.toMatchObject({ status: 422, code: "transfer.kind_change" });
  });

  it("moves an endpoint to an account that exists, is the user's and is not archived", async () => {
    const t = await transferOf(f.pfChecking, f.broker, 100);
    const { from, to } = await legs(t.transferGroupId!);
    await expect(updateEntry(USER, from.id, { fromAccountId: o.pfChecking }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    const archived = await savingsOf();
    await prisma.account.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await expect(updateEntry(USER, to.id, { toAccountId: archived.id }, prisma)).rejects.toMatchObject({ code: "account.archived" });
    await expect(updateEntry(USER, from.id, { fromAccountId: f.broker }, prisma)).rejects.toMatchObject({ code: "transfer.same_account" });
    // The addressed leg's account can be moved with accountId alone.
    const savings = await savingsOf();
    const moved = await updateEntry(USER, to.id, { accountId: savings.id }, prisma);
    expect((await legs(t.transferGroupId!)).to.accountId).toBe(savings.id);
    expect(moved.raw.accountId).toBe(savings.id);
  });

  it("sets the direction by hand, flips to a reimbursement and back, and re-infers when the endpoints imply it", async () => {
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 100);
    const { from } = await legs(t.transferGroupId!);
    const group = () => prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } });
    expect((await group()).direction).toBe("between_accounts");

    await updateEntry(USER, from.id, { direction: "capital_injection" }, prisma);
    expect((await group()).direction).toBe("capital_injection");

    await updateEntry(USER, from.id, { reimbursement: true }, prisma);
    expect((await group()).direction).toBe("reimbursement");
    expect((await legs(t.transferGroupId!)).all.every((l) => l.kind === "expense")).toBe(true);

    await updateEntry(USER, from.id, { reimbursement: false }, prisma);
    expect((await group()).direction).toBe("between_accounts");
    expect((await legs(t.transferGroupId!)).all.every((l) => l.kind === "transfer")).toBe(true);

    // false on something that is not a reimbursement changes nothing.
    await updateEntry(USER, from.id, { reimbursement: false, notes: "ok" }, prisma);
    expect((await group()).direction).toBe("between_accounts");

    // Moving an endpoint re-infers the direction the old endpoints implied.
    await updateEntry(USER, from.id, { toAccountId: f.broker }, prisma);
    expect((await group()).direction).toBe("investment_deposit");
    // Moving one while the direction was set by hand keeps it.
    await updateEntry(USER, from.id, { direction: "profit_distribution" }, prisma);
    await updateEntry(USER, from.id, { toAccountId: savings.id }, prisma);
    expect((await group()).direction).toBe("profit_distribution");
  });

  it("edits date, description, notes and the addressed leg's category and tax flag across the whole transfer", async () => {
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 100, { description: "Antes" });
    const { from } = await legs(t.transferGroupId!);
    const r = await updateEntry(USER, from.id, { date: "2026-10-02", description: "Depois", notes: "n", isTaxDeductible: true }, prisma);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } });
    expect(group).toMatchObject({ description: "Depois" });
    expect(group.date.toISOString().slice(0, 10)).toBe("2026-10-02");
    const all = (await legs(t.transferGroupId!)).all;
    expect(all.every((l) => l.description === "Depois" && l.notes === "n" && l.date.toISOString().slice(0, 10) === "2026-10-02")).toBe(true);
    expect(all.find((l) => l.id === from.id)?.isTaxDeductible).toBe(true);
    expect(all.find((l) => l.id !== from.id)?.isTaxDeductible).toBe(false);
    expect(r.raw.id).toBe(from.id);

    // A reimbursement's expense legs carry a category; turning it back drops it.
    await updateEntry(USER, from.id, { reimbursement: true }, prisma);
    await updateEntry(USER, from.id, { categoryId: f.categories.Groceries }, prisma);
    expect((await row(from.id)).categoryId).toBe(f.categories.Groceries);
    await updateEntry(USER, from.id, { reimbursement: false }, prisma);
    expect((await row(from.id)).categoryId).toBeNull();
  });

  it("scales both legs when only the amount changes, and sets them outright when the leg was zero", async () => {
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 100);
    const { from, to } = await legs(t.transferGroupId!);
    await updateEntry(USER, from.id, { amount: 250 }, prisma);
    let now = await legs(t.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-250);
    expect(toNumber(now.to.amount)).toBe(250);
    expect(toNumber(now.to.amountBase)).toBe(250);

    await prisma.ledgerEntry.updateMany({ where: { id: { in: [from.id, to.id] } }, data: { amount: 0, amountBase: 0 } });
    await updateEntry(USER, to.id, { amount: 40 }, prisma);
    now = await legs(t.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-40);
    expect(toNumber(now.to.amount)).toBe(40);
    expect(toNumber(now.to.amountBase)).toBe(40);
  });

  it("refuses a received amount or a rate on a same-currency transfer", async () => {
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 100);
    const { from } = await legs(t.transferGroupId!);
    await expect(updateEntry(USER, from.id, { toAmount: 90 }, prisma)).rejects.toMatchObject({ status: 422, code: "transfer.same_currency" });
    await expect(updateEntry(USER, from.id, { exchangeRate: 4 }, prisma)).rejects.toMatchObject({ code: "transfer.same_currency" });
    // A rate of 1 is no rate.
    const ok = await updateEntry(USER, from.id, { exchangeRate: 1, notes: "x" }, prisma);
    expect(ok.raw.notes).toBe("x");
  });

  it("restates a base/foreign transfer from a stated rate, whichever leg is the base", async () => {
    const usd = await usdAccount();
    const out = await transferOf(f.pfChecking, usd.id, 1000, { toAmount: 200 });
    const outLegs = await legs(out.transferGroupId!);
    await updateEntry(USER, outLegs.from.id, { exchangeRate: 4 }, prisma);
    let now = await legs(out.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-1000);
    expect(toNumber(now.to.amount)).toBe(250);
    expect(toNumber(now.to.exchangeRate)).toBe(4);
    expect(toNumber(now.from.exchangeRate)).toBe(1);
    expect(toNumber(now.from.amountBase)).toBe(-1000);
    expect(toNumber(now.to.amountBase)).toBe(1000);

    const back = await transferOf(usd.id, f.pfChecking, 100, { toAmount: 480 });
    const backLegs = await legs(back.transferGroupId!);
    await updateEntry(USER, backLegs.from.id, { exchangeRate: 5 }, prisma);
    now = await legs(back.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-100);
    expect(toNumber(now.to.amount)).toBe(500);
    expect(toNumber(now.from.exchangeRate)).toBe(5);
    expect(toNumber(now.to.exchangeRate)).toBe(1);
    expect(toNumber(now.to.amountBase)).toBe(-toNumber(now.from.amountBase));
  });

  it("falls back to the stated rate when a restated leg rounds to nothing", async () => {
    const usd = await usdAccount();
    const out = await transferOf(f.pfChecking, usd.id, 1000, { toAmount: 200 });
    await updateEntry(USER, (await legs(out.transferGroupId!)).from.id, { amount: 0.001, exchangeRate: 4 }, prisma);
    const side = async (groupId: string, accountId: string) => (await legs(groupId)).all.find((l) => l.accountId === accountId)!;
    expect(toNumber((await side(out.transferGroupId!, f.pfChecking)).amount)).toBe(0);
    expect(toNumber((await side(out.transferGroupId!, usd.id)).amount)).toBe(0);
    expect(toNumber((await side(out.transferGroupId!, usd.id)).exchangeRate)).toBe(4);

    const back = await transferOf(usd.id, f.pfChecking, 100, { toAmount: 480 });
    await updateEntry(USER, (await legs(back.transferGroupId!)).from.id, { amount: 0.001, exchangeRate: 4 }, prisma);
    expect(toNumber((await side(back.transferGroupId!, usd.id)).amount)).toBe(0);
    expect(toNumber((await side(back.transferGroupId!, usd.id)).exchangeRate)).toBe(4);
    expect(toNumber((await side(back.transferGroupId!, f.pfChecking)).amount)).toBe(0);
  });

  it("restates the legs from a new sent amount together with the received one", async () => {
    const usd = await usdAccount();
    const t = await transferOf(f.pfChecking, usd.id, 1000, { toAmount: 200 });
    const { from } = await legs(t.transferGroupId!);
    await updateEntry(USER, from.id, { amount: 1100, toAmount: 220 }, prisma);
    const now = await legs(t.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-1100);
    expect(toNumber(now.to.amount)).toBe(220);
    expect(toNumber(now.to.exchangeRate)).toBe(5);
  });

  it("refuses to restate a pair with neither leg in the base currency, but still scales it by amount", async () => {
    const e = await euroUser();
    const t = await createEntry(EURO, { kind: "transfer", fromAccountId: e.brl.id, toAccountId: e.usd.id, amount: 100, date: "2026-09-20" }, prisma);
    const { from } = await legs(t.transferGroupId!);
    await expect(updateEntry(EURO, from.id, { toAmount: 30 }, prisma)).rejects.toMatchObject({ status: 422, code: "transfer.fx_required" });
    await expect(updateEntry(EURO, from.id, { exchangeRate: 4 }, prisma)).rejects.toMatchObject({ code: "transfer.fx_required" });
    // Only the amount changed: both legs scale at the stored rates.
    await updateEntry(EURO, from.id, { amount: 200 }, prisma);
    const now = await legs(t.transferGroupId!);
    expect(toNumber(now.from.amount)).toBe(-200);
    expect(toNumber(now.to.amount)).toBe(50);
    expect(toNumber(now.from.amountBase)).toBe(-40);
    expect(toNumber(now.to.amountBase)).toBe(40);
  });

  it("refuses a received amount that rounds to zero", async () => {
    const usd = await usdAccount();
    const base = await transferOf(f.pfChecking, usd.id, 100);
    await expect(updateEntry(USER, (await legs(base.transferGroupId!)).from.id, { toAmount: 0.001 }, prisma)).rejects.toMatchObject({ code: "transfer.fx_required" });
  });

  it("re-expresses a leg moved to another currency at today's rate, or refuses when none is stored", async () => {
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 100);
    const { from } = await legs(t.transferGroupId!);
    const usd = await usdAccount();
    await updateEntry(USER, from.id, { toAccountId: usd.id }, prisma);
    const now = await legs(t.transferGroupId!);
    expect(now.to.accountId).toBe(usd.id);
    expect(now.to.currency).toBe("USD");
    expect(toNumber(now.to.exchangeRate)).toBe(5);
    expect(toNumber(now.to.amount)).toBe(20);

    const eur = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Degiro", currency: "EUR" } });
    await expect(updateEntry(USER, from.id, { toAccountId: eur.id }, prisma)).rejects.toMatchObject({ status: 422, code: "transfer.fx_required" });
    expect((await legs(t.transferGroupId!)).to.accountId).toBe(usd.id);
  });

  it("moves the bill payment to the other card's statement when the destination card changes", async () => {
    const second = await prisma.account.create({
      data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Inter", currency: "BRL", creditLimit: 1000, closingDay: 5, dueDay: 12, payFromAccountId: f.pfChecking },
    });
    await expense({ accountId: f.card, date: "2026-09-03", amount: 80 });
    await expense({ accountId: second.id, date: "2026-09-03", amount: 50, description: "Outra" });
    const t = await transferOf(f.pfChecking, f.card, 80, { date: "2026-09-12" });
    const statement = (accountId: string) => prisma.cardStatement.findFirstOrThrow({ where: { accountId } });
    expect((await statement(f.card)).paymentGroupId).toBe(t.transferGroupId);
    await updateEntry(USER, (await legs(t.transferGroupId!)).from.id, { toAccountId: second.id }, prisma);
    expect((await statement(f.card)).paymentGroupId).toBeNull();
    expect((await statement(second.id)).paymentGroupId).toBe(t.transferGroupId);
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } })).direction).toBe("card_payment");
  });

  it("links a transfer to the card's open statement when it becomes a card payment, and keeps it linked while the card moves", async () => {
    await expense({ accountId: f.card, date: "2026-09-03", amount: 80 });
    const savings = await savingsOf();
    const t = await transferOf(f.pfChecking, savings.id, 80, { date: "2026-09-12" });
    const { from } = await legs(t.transferGroupId!);
    await updateEntry(USER, from.id, { toAccountId: f.card }, prisma);
    expect((await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } })).paymentGroupId).toBe(t.transferGroupId);
    await updateEntry(USER, from.id, { toAccountId: savings.id }, prisma);
    expect((await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } })).paymentGroupId).toBeNull();
  });
});

describe("softDeleteEntries, restoreEntries and the trash", () => {
  it("404s when nothing selected exists, and names the batch after the summary", async () => {
    await expect(softDeleteEntries(USER, ["nope"], prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    const e = await expense();
    const r = await softDeleteEntries(USER, e.entryIds, prisma, { summary: "Limpeza" });
    expect(r).toMatchObject({ deleted: 1 });
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId! } })).summary).toBe("Limpeza");
    await expect(softDeleteEntries(USER, e.entryIds, prisma)).rejects.toMatchObject({ code: "entry.not_found" });
  });

  it("can skip the undo log or collect into the caller's batch", async () => {
    const a = await expense();
    const b = await expense({ description: "Outra" });
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    expect((await softDeleteEntries(USER, a.entryIds, prisma, { record: false })).batchId).toBeNull();
    const collect: MutationRecordInput[] = [];
    expect((await softDeleteEntries(USER, b.entryIds, prisma, { collect })).batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
  });

  it("counts a trashed transfer once, and restoring brings both legs and the group back", async () => {
    const t = await transferOf(f.pfChecking, f.broker, 10);
    const lone = await expense();
    await softDeleteEntries(USER, [...t.entryIds.slice(0, 1), ...lone.entryIds], prisma);
    expect(await trashRowCount(USER, prisma)).toBe(2);
    const r = await restoreEntries(USER, t.entryIds.slice(0, 1), prisma);
    expect(r.restored).toBe(2);
    expect(await trashRowCount(USER, prisma)).toBe(1);
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } })).deletedAt).toBeNull();
    expect(await trashRowCount(OTHER, prisma)).toBe(0);
  });

  it("duplicates a transfer as a new group with the copy suffix on every description", async () => {
    const t = await transferOf(f.pfChecking, f.broker, 10, { description: "Aporte" });
    const copy = await duplicateEntries(USER, t.entryIds.slice(0, 1), prisma);
    expect(copy.entryIds).toHaveLength(2);
    const copies = await prisma.ledgerEntry.findMany({ where: { id: { in: copy.entryIds } } });
    expect(new Set(copies.map((c) => c.transferGroupId)).size).toBe(1);
    expect(copies[0].transferGroupId).not.toBe(t.transferGroupId);
    expect(copies.every((c) => c.description.startsWith("Aporte "))).toBe(true);
    expect(copies.every((c) => c.description.length > "Aporte ".length)).toBe(true);
  });
});

describe("purgeTrash", () => {
  it("leaves recent trash alone and purges a transfer's group with both legs once it is old enough", async () => {
    expect(await purgeTrash(prisma, 30, USER)).toEqual({ groups: 0, entries: 0 });
    const t = await transferOf(f.pfChecking, f.broker, 10);
    const lone = await expense();
    await softDeleteEntries(USER, [t.entryIds[0], ...lone.entryIds], prisma);
    expect(await purgeTrash(prisma, 30, USER)).toEqual({ groups: 0, entries: 0 });
    expect(await trashRowCount(USER, prisma)).toBe(2);

    // The group goes first and takes its two legs with it; only the lone entry is counted as an entry.
    expect(await purgeTrash(prisma, 0, USER)).toEqual({ groups: 1, entries: 1 });
    expect(await prisma.transferGroup.count({ where: { id: t.transferGroupId! } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(0);
    const purgeBatch = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, op: "purge" }, include: { records: true } });
    expect(purgeBatch.records.map((r) => r.model).sort()).toEqual(["LedgerEntry", "LedgerEntry", "LedgerEntry", "TransferGroup"]);
  });
});

describe("bulk updates", () => {
  it("does nothing, and records nothing, when no entry would change", async () => {
    const e = await expense({ categoryId: f.categories.Groceries });
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const same = await bulkUpdateEntries(USER, e.entryIds, { categoryId: f.categories.Groceries, accountId: f.pfChecking, isTaxDeductible: false }, prisma);
    expect(same).toEqual({ batchId: null, changed: 0, matched: 1, rulesLearned: 0 });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
    const preview = await previewBulkUpdate(USER, e.entryIds, { categoryId: f.categories.Groceries, accountId: f.pfChecking, isTaxDeductible: false }, prisma);
    expect(preview).toEqual({ matched: 1, changed: 0, byField: { categoryId: { changed: 0, unchanged: 1 }, accountId: { changed: 0, unchanged: 1 }, isTaxDeductible: { changed: 0, unchanged: 1 } }, rulesLearned: 0 });
  });

  it("moves to another account, sets or toggles the tax flag, and clears the category", async () => {
    const a = await expense({ categoryId: f.categories.Groceries });
    const b = await expense({ description: "Outra", isTaxDeductible: true });
    const moved = await bulkUpdateEntries(USER, [...a.entryIds, ...b.entryIds], { accountId: f.broker, toggleTaxDeductible: true, categoryId: null }, prisma);
    expect(moved).toMatchObject({ changed: 2, matched: 2 });
    expect(await row(a.entryIds[0])).toMatchObject({ accountId: f.broker, isTaxDeductible: true, categoryId: null });
    expect(await row(b.entryIds[0])).toMatchObject({ accountId: f.broker, isTaxDeductible: false });
    const set = await bulkUpdateEntries(USER, a.entryIds, { isTaxDeductible: false }, prisma);
    expect(set.changed).toBe(1);
    expect((await row(a.entryIds[0])).isTaxDeductible).toBe(false);
    await undoBatch(USER, set.batchId!, prisma);
    expect((await row(a.entryIds[0])).isTaxDeductible).toBe(true);
  });

  it("leaves an investment cash leg on its broker and a transfer's legs on theirs when moving", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itau" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 20, totalAmount: 200, date: "2026-09-10" }, prisma);
    expect((await row(buy.cashEntryId!)).kind).toBe("investment");
    const t = await transferOf(f.pfChecking, f.broker, 30);
    const selection = [buy.cashEntryId!, ...t.entryIds];

    const preview = await previewBulkUpdate(USER, selection, { accountId: f.pjChecking }, prisma);
    expect(preview).toMatchObject({ matched: 2, changed: 0, byField: { accountId: { changed: 0, unchanged: 2 } } });
    const res = await bulkUpdateEntries(USER, selection, { accountId: f.pjChecking, entityId: f.pjId }, prisma);
    expect(res).toMatchObject({ changed: 0, matched: 2, batchId: null });
    expect((await row(buy.cashEntryId!)).accountId).toBe(f.broker);
    expect((await legs(t.transferGroupId!)).all.map((l) => l.accountId).sort()).toEqual([f.pfChecking, f.broker].sort());
  });

  it("refuses a category of the wrong type or an archived one, in the dry run as in the write", async () => {
    const e = await expense();
    await expect(previewBulkUpdate(USER, e.entryIds, { categoryId: f.categories.Salary }, prisma)).rejects.toMatchObject({ code: "category.type_mismatch" });
    await expect(bulkUpdateEntries(USER, e.entryIds, { categoryId: f.categories.Salary }, prisma)).rejects.toMatchObject({ code: "category.type_mismatch" });
    await expect(previewBulkUpdate(USER, e.entryIds, { categoryId: "nope" }, prisma)).rejects.toMatchObject({ code: "category.not_found" });
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    await expect(previewBulkUpdate(USER, e.entryIds, { categoryId: f.categories.Software }, prisma)).rejects.toMatchObject({ code: "category.archived" });
  });

  it("counts a rule as learned only when it would create or move one", async () => {
    const e = await expense({ description: "  " });
    const blank = await previewBulkUpdate(USER, e.entryIds, { categoryId: f.categories.Groceries }, prisma, { createRule: true });
    expect(blank.rulesLearned).toBe(0);

    const a = await expense({ description: "Padaria" });
    const first = await bulkUpdateEntries(USER, a.entryIds, { categoryId: f.categories.Groceries }, prisma, { createRule: true });
    expect(first.rulesLearned).toBe(1);
    // The same rule (same category, source bulk) already exists: a second run learns nothing new.
    const b = await expense({ description: "Padaria" });
    const preview = await previewBulkUpdate(USER, b.entryIds, { categoryId: f.categories.Groceries }, prisma, { createRule: true });
    expect(preview.rulesLearned).toBe(0);
    const again = await bulkUpdateEntries(USER, b.entryIds, { categoryId: f.categories.Groceries }, prisma, { createRule: true });
    expect(again.rulesLearned).toBe(0);
    // Pointing it at another category moves the rule.
    const moved = await previewBulkUpdate(USER, b.entryIds, { categoryId: f.categories.Software }, prisma, { createRule: true });
    expect(moved.rulesLearned).toBe(1);
  });
});

describe("getEntry", () => {
  it("returns the serialized entry and 404s for another user's", async () => {
    const e = await expense({ categoryId: f.categories.Groceries });
    expect(await getEntry(USER, e.entryIds[0], prisma)).toMatchObject({ id: e.entryIds[0], kind: "expense", amount: -100 });
    await expect(getEntry(OTHER, e.entryIds[0], prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
  });
});
