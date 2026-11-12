import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { categoryResolver, legacyType } from "../../lib/ledger-adapter";
import { deleteTransactionTool, findOwnedEntry, toPatch, updateTransactionTool } from "../manage-transactions";

const USER = "test-user-mcp-manage-001";
const OTHER = "test-user-mcp-manage-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Groceries", type: "expense" },
      { name: "Restaurants", type: "expense" },
      { name: "Salary", type: "income" },
    ],
  });
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const expense = async (over: { description?: string; categoryId?: string | null; date?: string } = {}) =>
  (
    await createEntry(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 100, date: over.date ?? "2026-09-10", description: over.description ?? "Mercado", categoryId: over.categoryId === undefined ? f.categories.Groceries : over.categoryId },
      prisma,
      { skipRules: true },
    )
  ).entryIds[0];

describe("toPatch", () => {
  const existing = (over: Partial<{ kind: string; amount: number; categoryId: string | null }> = {}) => ({ kind: "expense", amount: -100, categoryId: f.categories.Groceries, ...over });

  it("is empty when nothing changes", async () => {
    expect(toPatch({}, existing(), await categoryResolver(USER, prisma))).toEqual({});
  });

  it("carries only the fields that were sent, zero and false included, normalizing the date", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(
      toPatch(
        { type: "income", amount: 0, currency: "USD", exchangeRate: 5, toAmount: 20, description: "Novo", date: "2026-10-01T23:30:00.000Z", isTaxDeductible: false },
        existing(),
        resolver,
      ),
    ).toEqual({ kind: "income", amount: 0, currency: "USD", exchangeRate: 5, toAmount: 20, description: "Novo", date: "2026-10-01", isTaxDeductible: false });
  });

  it("ignores an empty description, currency or date, and never changes the kind of a transfer leg", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(toPatch({ description: "", currency: "", date: "" }, existing(), resolver)).toEqual({});
    expect(toPatch({ type: "income", amount: 5 }, existing({ kind: "transfer" }), resolver)).toEqual({ amount: 5 });
  });

  it("resolves a category name against the entry's type, or against the new type when it changes", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(toPatch({ category: "restaurants" }, existing(), resolver)).toEqual({ categoryId: f.categories.Restaurants });
    expect(toPatch({ category: "Salary", type: "income" }, existing(), resolver)).toEqual({ kind: "income", categoryId: f.categories.Salary });
    // Salary is an income category, so it is not a match for an expense.
    expect(() => toPatch({ category: "Salary" }, existing(), resolver)).toThrow(/Category 'Salary' not found \(type: expense\)/);
  });

  it("leaves the category alone when it names the one the entry already has", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(toPatch({ category: "groceries" }, existing(), resolver)).toEqual({});
  });

  it("lets an entry keep its archived category but refuses to move to another archived one", async () => {
    await prisma.category.update({ where: { id: f.categories.Groceries }, data: { isArchived: true } });
    await prisma.category.update({ where: { id: f.categories.Restaurants }, data: { isArchived: true } });
    const resolver = await categoryResolver(USER, prisma);
    expect(toPatch({ category: "Groceries" }, existing(), resolver)).toEqual({});
    expect(() => toPatch({ category: "Restaurants" }, existing(), resolver)).toThrow(/archived/);
  });

  it("sets or clears the category an income reimburses, always looked up among expenses", async () => {
    const resolver = await categoryResolver(USER, prisma);
    const income = existing({ kind: "income", amount: 30 });
    expect(toPatch({ reimbursesCategory: "Groceries" }, income, resolver)).toEqual({ reimbursesCategoryId: f.categories.Groceries });
    expect(toPatch({ reimbursesCategory: null }, income, resolver)).toEqual({ reimbursesCategoryId: null });
    expect(() => toPatch({ reimbursesCategory: "Salary" }, income, resolver)).toThrow(/type: expense/);
  });
});

describe("categoryResolver", () => {
  it("names a category by id, and answers null for no id or an id it does not know", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(resolver.nameOf(f.categories.Groceries)).toBe("Groceries");
    expect(resolver.nameOf(null)).toBeNull();
    expect(resolver.nameOf("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("resolves names exactly, then ignoring case, and only among the user's own categories", async () => {
    const resolver = await categoryResolver(USER, prisma);
    expect(resolver.resolve("Groceries", "expense").id).toBe(f.categories.Groceries);
    expect(resolver.resolve("gROCERIES", undefined).id).toBe(f.categories.Groceries);
    expect(() => resolver.resolve("Alheia", "expense")).toThrow(/not found/);
    expect(resolver.categories.map((c) => c.name).sort()).toEqual(["Groceries", "Restaurants", "Salary"]);
  });
});

describe("legacyType", () => {
  it("is the ledger kind, and for a transfer leg the direction of the money", () => {
    expect(legacyType({ kind: "income", amount: 1 as never })).toBe("income");
    expect(legacyType({ kind: "investment", amount: -1 as never })).toBe("investment");
    expect(legacyType({ kind: "transfer", amount: 10 as never })).toBe("income");
    expect(legacyType({ kind: "transfer", amount: -10 as never })).toBe("expense");
  });
});

describe("findOwnedEntry", () => {
  it("finds a live entry of the user and nothing else", async () => {
    const id = await expense();
    expect((await findOwnedEntry(USER, id, prisma))?.id).toBe(id);
    expect(await findOwnedEntry(OTHER, id, prisma)).toBeNull();
    await prisma.ledgerEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await findOwnedEntry(USER, id, prisma)).toBeNull();
  });
});

describe("updateTransactionTool", () => {
  it("changes description, tax flag, date and category in one undoable batch and answers the row as the MCP shows it", async () => {
    const id = await expense();
    const batchesBefore = await prisma.mutationBatch.count({ where: { userId: USER } });

    const updated = await updateTransactionTool(USER, { id, description: "Feira", isTaxDeductible: true, date: "2026-10-02", category: "Restaurants" }, prisma);

    expect(updated).toMatchObject({ id, description: "Feira", isTaxDeductible: true, category: "Restaurants", type: "expense", amount: 100, accountId: f.pfChecking, transferGroupId: null, counterpartAmount: null });
    expect(updated.date).toBe("2026-10-02T12:00:00.000Z");
    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
    expect([row.description, row.isTaxDeductible, row.categoryId]).toEqual(["Feira", true, f.categories.Restaurants]);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batchesBefore + 1);
  });

  it("restates the currency and exchange rate, keeping the amount", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const id = await expense();

    const updated = await updateTransactionTool(USER, { id, currency: "USD", exchangeRate: 5, amount: 20 }, prisma);

    expect(updated).toMatchObject({ currency: "USD", exchangeRate: 5, amount: 20 });
    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
    expect([row.currency, Number(row.amount), Number(row.amountBase)]).toEqual(["USD", -20, -100]);
  });

  it("turns an expense into an income of another category", async () => {
    const id = await expense();
    const updated = await updateTransactionTool(USER, { id, type: "income", category: "Salary" }, prisma);
    expect(updated).toMatchObject({ type: "income", category: "Salary", amount: 100 });
    expect(Number((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).amount)).toBe(100);
  });

  it("refuses an entry that is not the user's or does not exist, writing nothing", async () => {
    const id = await expense();
    await expect(updateTransactionTool(OTHER, { id, description: "hack" }, prisma)).rejects.toThrow("Transaction not found or access denied");
    await expect(updateTransactionTool(USER, { id: "00000000-0000-4000-8000-000000000000", description: "x" }, prisma)).rejects.toThrow("Transaction not found or access denied");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).description).toBe("Mercado");
  });

  it("refuses an unknown category with suggestions, and leaves the entry as it was", async () => {
    const id = await expense();
    await expect(updateTransactionTool(USER, { id, category: "Grocerys" }, prisma)).rejects.toThrow(/Did you mean: Groceries/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).categoryId).toBe(f.categories.Groceries);
  });
});

describe("deleteTransactionTool", () => {
  it("moves the entry to the trash and refuses it a second time, or for another user", async () => {
    const id = await expense({ description: "Para apagar" });
    await expect(deleteTransactionTool(OTHER, id, prisma)).rejects.toThrow("Transaction not found or access denied");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();

    await deleteTransactionTool(USER, id, prisma);

    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    await expect(deleteTransactionTool(USER, id, prisma)).rejects.toThrow("Transaction not found or access denied");
  });

  it("takes both legs of a transfer with it", async () => {
    const created = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 40, date: "2026-09-10", description: "Aporte" }, prisma, { skipRules: true });
    await deleteTransactionTool(USER, created.entryIds[0], prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: created.transferGroupId! } });
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => leg.deletedAt !== null)).toBe(true);
  });
});
