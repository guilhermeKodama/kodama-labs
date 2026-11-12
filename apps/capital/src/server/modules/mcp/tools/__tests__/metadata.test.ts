import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getValidTypes, listAccounts, listCategoriesForMcp } from "../metadata";

const USER = "test-user-mcp-metadata-001";
const OTHER = "test-user-mcp-metadata-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Groceries", type: "expense" },
      { name: "Software", type: "expense" },
      { name: "Salary", type: "income" },
      { name: "Stocks", type: "investment" },
    ],
  });
  await createLedgerFixture(prisma, OTHER, { categories: [{ name: "Alheia", type: "expense" }] });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const entry = (categoryId: string, over: { kind?: "income" | "expense"; description?: string } = {}) =>
  createEntry(USER, { kind: over.kind ?? "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-02", description: over.description ?? "x", categoryId }, prisma, { skipRules: true });

describe("getValidTypes", () => {
  it("lists the three transaction types in order", () => {
    expect(getValidTypes()).toEqual({ types: ["income", "expense", "investment"] });
  });
});

describe("listCategoriesForMcp", () => {
  it("lists the user's categories with how many live entries use each", async () => {
    await entry(f.categories.Groceries);
    await entry(f.categories.Groceries, { description: "y" });
    const trashed = (await entry(f.categories.Groceries, { description: "na lixeira" })).entryIds[0];
    await prisma.ledgerEntry.update({ where: { id: trashed }, data: { deletedAt: new Date() } });
    await entry(f.categories.Salary, { kind: "income" });

    const { categories } = await listCategoriesForMcp(USER, undefined, prisma);

    const count = (name: string) => categories.find((c) => c.name === name)?.transactionCount;
    expect(count("Groceries")).toBe(2);
    expect(count("Salary")).toBe(1);
    expect(count("Software")).toBe(0);
    expect(categories.map((c) => c.name).sort()).toEqual(["Groceries", "Salary", "Software", "Stocks"]);
    expect(categories.find((c) => c.name === "Groceries")).toMatchObject({
      id: f.categories.Groceries,
      name: "Groceries",
      type: "expense",
      isDefault: false,
      isSystem: false,
      systemKey: null,
      isArchived: false,
      transactionCount: 2,
    });
  });

  it("filters by type, and never shows another user's categories", async () => {
    const expenses = await listCategoriesForMcp(USER, "expense", prisma);
    expect(expenses.categories.map((c) => c.name).sort()).toEqual(["Groceries", "Software"]);
    const investments = await listCategoriesForMcp(USER, "investment", prisma);
    expect(investments.categories.map((c) => c.name)).toEqual(["Stocks"]);
    expect((await listCategoriesForMcp(OTHER, undefined, prisma)).categories.map((c) => c.name)).toEqual(["Alheia"]);
  });

  it("hides archived categories unless asked", async () => {
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    expect((await listCategoriesForMcp(USER, "expense", prisma)).categories.map((c) => c.name)).toEqual(["Groceries"]);
    const all = await listCategoriesForMcp(USER, "expense", prisma, true);
    expect(all.categories.map((c) => [c.name, c.isArchived]).sort()).toEqual([
      ["Groceries", false],
      ["Software", true],
    ]);
  });

  it("is empty for a user without categories", async () => {
    expect(await listCategoriesForMcp("test-user-mcp-metadata-nobody", undefined, prisma)).toEqual({ categories: [] });
  });
});

describe("listAccounts", () => {
  it("lists the businesses and the personal entity the transaction tools take ids from", async () => {
    const r = await listAccounts(USER, prisma);
    expect(r.businesses).toEqual([expect.objectContaining({ id: f.pjId, name: "Kodama LTDA", description: null, defaultCurrency: "BRL", entityType: "business" })]);
    expect(r.personalAccount).toEqual({ id: f.pfId, name: "Personal", defaultCurrency: "BRL", entityType: "personal", accounts: expect.any(Array) });
    // Each entity carries the ledger accounts a transaction can be booked on, with its main account flagged.
    expect(r.personalAccount!.accounts).toContainEqual({ id: f.pfChecking, name: "Conta principal", type: "checking", currency: "BRL", isDefault: true, archived: false });
  });

  it("hides an archived ledger account unless includeArchived is set, and flags it", async () => {
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });

    const hidden = await listAccounts(USER, prisma);
    expect(hidden.personalAccount!.accounts.map((a) => a.id)).not.toContain(f.broker);

    const shown = await listAccounts(USER, prisma, { includeArchived: true });
    expect(shown.personalAccount!.accounts).toContainEqual(expect.objectContaining({ id: f.broker, archived: true }));
  });

  it("leaves out an archived business, and lists several in the order they were created", async () => {
    const second = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Segunda PJ", defaultCurrency: "USD" } });
    const archived = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Encerrada", defaultCurrency: "BRL", archivedAt: new Date() } });

    const { businesses } = await listAccounts(USER, prisma);

    expect(businesses.map((b) => b.name)).toEqual(["Kodama LTDA", "Segunda PJ"]);
    expect(businesses.map((b) => b.id)).not.toContain(archived.id);
    expect(businesses[1]).toMatchObject({ id: second.id, defaultCurrency: "USD" });
  });

  it("has no personal account for a user who has none, and nothing for a user with no entities", async () => {
    const bare = "test-user-mcp-metadata-bare";
    await prisma.user.deleteMany({ where: { id: bare } });
    await prisma.user.create({ data: { id: bare, email: `${bare}@example.com`, passwordHash: "x", name: bare } });
    try {
      expect(await listAccounts(bare, prisma)).toEqual({ businesses: [], personalAccount: null });
      await prisma.entity.create({ data: { userId: bare, kind: "business", name: "Só PJ", defaultCurrency: "BRL" } });
      const onlyBusiness = await listAccounts(bare, prisma);
      expect(onlyBusiness.personalAccount).toBeNull();
      expect(onlyBusiness.businesses.map((b) => b.name)).toEqual(["Só PJ"]);
    } finally {
      await prisma.user.deleteMany({ where: { id: bare } });
    }
  });
});
