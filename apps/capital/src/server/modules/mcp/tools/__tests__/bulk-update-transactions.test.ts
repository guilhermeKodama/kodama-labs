import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { findOrphanTransactions, validateCategory } from "../../lib/category-validation";
import { bulkUpdateTransactions } from "../bulk-update-transactions";
import { listTransactions } from "../list-transactions";
import { deleteTransactionTool, updateTransactionTool } from "../manage-transactions";

const USER = "test-user-mcp-bulk-update-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Groceries", type: "expense" },
      { name: "Restaurants", type: "expense" },
      { name: "Salary", type: "income" },
    ],
  });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const expense = async (description: string, categoryId: string | null = f.categories.Groceries) =>
  (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-10", description, categoryId }, prisma, { skipRules: true })).entryIds[0];

describe("validateCategory", () => {
  it("accepts existing names and suggests close matches for unknown ones", async () => {
    expect((await validateCategory(USER, "Groceries", "expense", prisma)).valid).toBe(true);
    const typo = await validateCategory(USER, "Grocerys", "expense", prisma);
    expect(typo.valid).toBe(false);
    expect(typo.suggestions[0]).toBe("Groceries");
    expect((await validateCategory(USER, "Zzzz", "expense", prisma)).validNames).toEqual(expect.arrayContaining(["Groceries", "Restaurants"]));
  });
});

describe("findOrphanTransactions", () => {
  it("lists entries with no category or an archived one", async () => {
    await expense("ok");
    const none = await expense("none", null);
    const archived = await prisma.category.create({ data: { userId: USER, name: "Old", type: "expense" } });
    const old = await expense("old", archived.id);
    await prisma.category.update({ where: { id: archived.id }, data: { isArchived: true } });
    const r = await findOrphanTransactions(USER, prisma);
    expect(r.total).toBe(2);
    expect(r.transactions.map((t) => t.id).sort()).toEqual([none, old].sort());
    expect(r.categories.map((c) => c.name).sort()).toEqual(["(none)", "Old"]);
  });
});

describe("bulkUpdateTransactions", () => {
  it("updates several entries in one undoable batch", async () => {
    const a = await expense("a");
    const b = await expense("b");
    const r = await bulkUpdateTransactions(USER, [{ id: a, category: "Restaurants" }, { id: b, amount: 25, description: "B!" }], false, prisma);
    expect(r.errors).toEqual([]);
    expect(r.updated).toEqual([
      { id: a, description: "a", category: "Restaurants", amount: 10 },
      { id: b, description: "B!", category: "Groceries", amount: 25 },
    ]);
    await undoBatch(USER, r.batchId!, prisma);
    const back = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: b } });
    expect([back.description, Number(back.amount)]).toEqual(["b", -10]);
  });

  it("dry-run writes nothing", async () => {
    const a = await expense("a");
    const r = await bulkUpdateTransactions(USER, [{ id: a, category: "restaurants" }], true, prisma);
    expect(r.updated[0].category).toBe("Restaurants");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).categoryId).toBe(f.categories.Groceries);
  });

  it("is all-or-nothing on validation", async () => {
    const a = await expense("a");
    await expect(
      bulkUpdateTransactions(USER, [{ id: a, description: "changed" }, { id: "00000000-0000-0000-0000-000000000000", amount: 1 }, { id: a, category: "Nope" }], false, prisma)
    ).rejects.toThrow(/Validation failed for 2 transaction/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).description).toBe("a");
  });

  it("handles 200 updates", async () => {
    const ids = await Promise.all(Array.from({ length: 200 }, (_, i) => expense(`t${i}`)));
    const r = await bulkUpdateTransactions(USER, ids.map((id) => ({ id, category: "Restaurants" })), false, prisma);
    expect(r.updated).toHaveLength(200);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: f.categories.Restaurants } })).toBe(200);
  }, 60_000);

  it("normalizes dates to noon UTC", async () => {
    const a = await expense("a");
    await bulkUpdateTransactions(USER, [{ id: a, date: "2026-10-01" }], false, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).date.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("update_transaction / delete_transaction", () => {
  it("returns the legacy shape, keeps an archived category already set, and rejects assigning one", async () => {
    const a = await expense("a");
    const t = await updateTransactionTool(USER, { id: a, type: "income", category: "Salary", amount: 99 }, prisma);
    expect(t).toMatchObject({ id: a, type: "income", amount: 99, category: "Salary", personalAccountId: f.pfId, businessId: null });

    await prisma.category.update({ where: { id: f.categories.Salary }, data: { isArchived: true } });
    await expect(updateTransactionTool(USER, { id: a, category: "Salary", description: "kept" }, prisma)).resolves.toMatchObject({ description: "kept" });
    const b = await expense("b");
    await expect(updateTransactionTool(USER, { id: b, type: "income", category: "Salary" }, prisma)).rejects.toThrow(/archived/);
  });

  it("returns a refund as a negative expense from the list, the update and the orphan read-backs", async () => {
    const id = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: -20, date: "2026-09-10", description: "IOF de volta", categoryId: null }, prisma, { skipRules: true })).entryIds[0];
    const listed = await listTransactions(USER, { dateFrom: "2026-09-01", dateTo: "2026-09-30" }, prisma);
    expect(listed.transactions.find((t) => t.id === id)).toMatchObject({ type: "expense", amount: -20 });
    expect(listed.summaries.find((s) => s.type === "expense")?.total).toBeCloseTo(-20, 2);

    expect(await updateTransactionTool(USER, { id, description: "Estorno" }, prisma)).toMatchObject({ amount: -20, type: "expense" });
    const orphans = await findOrphanTransactions(USER, prisma);
    expect(orphans.transactions.find((t) => t.id === id)?.amount).toBe(-20);
    const bulk = await bulkUpdateTransactions(USER, [{ id, description: "IOF de volta" }], false, prisma);
    expect(bulk.updated[0].amount).toBe(-20);
    const preview = await bulkUpdateTransactions(USER, [{ id, description: "prévia" }], true, prisma);
    expect(preview.updated[0].amount).toBe(-20);
  });

  it("restates a cross-currency transfer from the amount that arrived", async () => {
    const usd = await prisma.account.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        type: "brokerage",
        name: "Crypto",
        currency: "USD",
      },
    });
    const created = await createEntry(
      USER,
      {
        kind: "transfer",
        fromAccountId: usd.id,
        toAccountId: f.pfChecking,
        amount: 100,
        toAmount: 500,
        date: "2026-09-10",
        description: "Resgate",
        direction: "investment_withdrawal",
      },
      prisma,
    );
    const usdLeg = await prisma.ledgerEntry.findFirstOrThrow({
      where: { transferGroupId: created.transferGroupId!, currency: "USD" },
    });
    const updated = await updateTransactionTool(
      USER,
      { id: usdLeg.id, toAmount: 480 },
      prisma,
    );
    expect(updated).toMatchObject({
      currency: "USD",
      transferGroupId: created.transferGroupId,
      counterpartAmount: 480,
      counterpartCurrency: "BRL",
      exchangeRate: 4.8,
    });
    const listed = await listTransactions(
      USER,
      { dateFrom: "2026-09-10", dateTo: "2026-09-10" },
      prisma,
    );
    const pair = listed.transactions.filter(
      (t) => t.transferGroupId === created.transferGroupId,
    );
    expect(pair).toHaveLength(2);
    expect(pair.find((t) => t.currency === "BRL")).toMatchObject({
      counterpartAmount: -100,
      counterpartCurrency: "USD",
      amount: 480,
    });
    expect(listed.summaries.every((s) => s.category !== "Resgate")).toBe(true);
  });

  it("delete moves the entry to the trash", async () => {
    const a = await expense("a");
    await deleteTransactionTool(USER, a, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).deletedAt).not.toBeNull();
    await expect(deleteTransactionTool(USER, a, prisma)).rejects.toThrow(/not found/);
  });
});
