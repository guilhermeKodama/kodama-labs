import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { recordDividend } from "@capital/server/modules/investments/services/dividends";
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

describe("reimbursesCategory", () => {
  it("sets and clears the expense category on an income", async () => {
    const id = (
      await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 30, date: "2026-09-10", description: "Pix", categoryId: f.categories.Salary }, prisma, { skipRules: true })
    ).entryIds[0];
    const set = await updateTransactionTool(USER, { id, reimbursesCategory: "Groceries" }, prisma);
    expect(set.reimbursesCategory).toBe("Groceries");
    await expect(updateTransactionTool(USER, { id, reimbursesCategory: "Salary" }, prisma)).rejects.toThrow(/type: expense/);
    const cleared = await bulkUpdateTransactions(USER, [{ id, reimbursesCategory: null }], false, prisma);
    expect(cleared.errors).toEqual([]);
    const listed = await listTransactions(USER, { dateFrom: "2026-09-10", dateTo: "2026-09-10" }, prisma);
    expect(listed.transactions.find((row) => row.id === id)?.reimbursesCategory).toBeNull();
  });
});

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
    expect(r.transactions.every((t) => t.accountId === f.pfChecking && t.accountName === "Conta principal" && t.operationId === null)).toBe(true);
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
      { id: a, description: "a", category: "Restaurants", amount: 10, operationId: null },
      { id: b, description: "B!", category: "Groceries", amount: 25, operationId: null },
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

  it("moves every row or none when one account is refused", async () => {
    const a = await expense("a");
    const b = await expense("b");
    const nubank = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Nubank PF", currency: "BRL" } });
    await expect(
      bulkUpdateTransactions(USER, [{ id: a, accountId: nubank.id }, { id: b, accountId: f.pjChecking }], false, prisma),
    ).rejects.toThrow(/different entity/);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: nubank.id } })).toBe(0);
    const dry = await bulkUpdateTransactions(USER, [{ id: a, accountId: nubank.id, description: "movida" }], true, prisma);
    expect(dry.updated[0]).toMatchObject({ accountId: nubank.id, description: "movida" });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).accountId).toBe(f.pfChecking);
    const applied = await bulkUpdateTransactions(USER, [{ id: a, accountId: nubank.id }, { id: b, description: "b2" }], false, prisma);
    expect(applied.errors).toEqual([]);
    expect(applied.updated.map((row) => row.accountId)).toEqual([nubank.id, undefined]);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).accountId).toBe(nubank.id);
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
    expect(t).toMatchObject({ id: a, type: "income", amount: 99, category: "Salary", personalAccountId: f.pfId, businessId: null, operationId: null });

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

  it("moves a transaction to another account of the same entity and the balances follow", async () => {
    const inter = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Inter PJ", currency: "BRL", initialBalance: 500 } });
    const nu = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Nu Empresas", currency: "BRL", initialBalance: 200 } });
    const id = (
      await createEntry(USER, { kind: "expense", accountId: inter.id, amount: 80, date: "2026-10-02", description: "Fornecedor", categoryId: f.categories.Groceries }, prisma, { skipRules: true })
    ).entryIds[0];
    const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId);

    expect(await balance(inter.id)).toBe(420);
    expect(await balance(nu.id)).toBe(200);

    const moved = await updateTransactionTool(USER, { id, accountId: nu.id }, prisma);
    expect(moved).toMatchObject({ id, accountId: nu.id, accountName: "Nu Empresas", businessId: f.pjId });
    expect(await balance(inter.id)).toBe(500);
    expect(await balance(nu.id)).toBe(120);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: inter.id } })).toMatchObject({ initialBalance: expect.anything() });
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: inter.id } })).initialBalance)).toBe(500);
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: nu.id } })).initialBalance)).toBe(200);

    const batch = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, op: "update" }, orderBy: { createdAt: "desc" } });
    await undoBatch(USER, batch.id, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).accountId).toBe(inter.id);
    expect(await balance(inter.id)).toBe(420);
    expect(await balance(nu.id)).toBe(200);
  });

  it("moves one leg of a same-entity transfer and leaves the other leg", async () => {
    const inter = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Inter PJ", currency: "BRL", initialBalance: 500 } });
    const nu = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Nu Empresas", currency: "BRL", initialBalance: 200 } });
    const created = await createEntry(
      USER,
      { kind: "transfer", fromAccountId: inter.id, toAccountId: nu.id, amount: 40, date: "2026-10-03", description: "Entre contas" },
      prisma,
    );
    const fromLeg = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: created.transferGroupId!, accountId: inter.id } });
    await updateTransactionTool(USER, { id: fromLeg.id, accountId: f.pjChecking }, prisma);
    const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId);
    expect(await balance(inter.id)).toBe(500);
    expect(await balance(nu.id)).toBe(240);
    expect(await balance(f.pjChecking)).toBe(-40);
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: created.transferGroupId!, amount: { gt: 0 } } })).accountId).toBe(nu.id);
  });

  it("refuses another entity, an archived account, a different currency, and an investment leg", async () => {
    const id = await expense("mercado");
    const archived = await prisma.account.create({
      data: { userId: USER, entityId: f.pfId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() },
    });
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Dólar", currency: "USD" } });
    await expect(updateTransactionTool(USER, { id, accountId: f.pjChecking }, prisma)).rejects.toThrow(/different entity/);
    await expect(updateTransactionTool(USER, { id, accountId: archived.id }, prisma)).rejects.toThrow(/archived/);
    await expect(updateTransactionTool(USER, { id, accountId: usd.id }, prisma)).rejects.toThrow(/Dólar/);
    await expect(updateTransactionTool(USER, { id, accountId: "00000000-0000-0000-0000-000000000000" }, prisma)).rejects.toThrow(/not found or access denied/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).accountId).toBe(f.pfChecking);

    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    const buy = await recordOperation(USER, { holdingId: holding.id, type: "buy", quantity: 1, pricePerUnit: 30, totalAmount: 30, date: "2026-09-01" }, prisma);
    await expect(updateTransactionTool(USER, { id: buy.cashEntryId!, accountId: f.pfChecking }, prisma)).rejects.toThrow(/PETR4/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: buy.cashEntryId! } })).accountId).toBe(f.broker);

    const dividend = await recordDividend(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: 12, date: "2026-09-20", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    const nubank = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Nubank PF", currency: "BRL" } });
    await expect(updateTransactionTool(USER, { id: dividend.cashEntryId!, accountId: nubank.id }, prisma)).rejects.toThrow(/update_dividend/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: dividend.cashEntryId! } })).accountId).toBe(f.pfChecking);

    const loose = (
      await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-11", description: "Aporte avulso" }, prisma, { kind: "investment", skipRules: true })
    ).entryIds[0];
    expect(await updateTransactionTool(USER, { id: loose, accountId: nubank.id }, prisma)).toMatchObject({ accountId: nubank.id, type: "investment" });
  });

  it("delete moves the entry to the trash", async () => {
    const a = await expense("a");
    await deleteTransactionTool(USER, a, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).deletedAt).not.toBeNull();
    await expect(deleteTransactionTool(USER, a, prisma)).rejects.toThrow(/not found/);
  });
});

describe("bulkUpdateTransactions edge cases", () => {
  it("does nothing for an empty list", async () => {
    expect(await bulkUpdateTransactions(USER, [], false, prisma)).toEqual({ updated: [], errors: [] });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(0);
  });

  it("dry-run shows the amount sent, the stored one otherwise, and the category as typed when it does not change", async () => {
    const a = await expense("a");
    const b = await expense("b");
    const batchesBefore = await prisma.mutationBatch.count({ where: { userId: USER } });
    const r = await bulkUpdateTransactions(USER, [{ id: a, amount: 77 }, { id: b, category: "Groceries", description: "B!" }], true, prisma);
    expect(r.errors).toEqual([]);
    expect(r.updated).toEqual([
      { id: a, description: "(unchanged)", category: undefined, amount: 77, operationId: null },
      { id: b, description: "B!", category: "Groceries", amount: 10, operationId: null },
    ]);
    expect(r.batchId).toBeUndefined();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batchesBefore);
  });

  it("reports a failure while writing as a batch error, with no partial update and no batch", async () => {
    const a = await expense("a");
    const checking2 = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Segunda", currency: "BRL" } });
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: checking2.id, amount: 50, date: "2026-09-10", description: "entre contas" }, prisma, { skipRules: true });
    const batchesBefore = await prisma.mutationBatch.count({ where: { userId: USER } });
    // The transfer passes validation, but a same-currency transfer has one amount: updateEntry refuses toAmount.
    const r = await bulkUpdateTransactions(USER, [{ id: a, description: "changed" }, { id: transfer.entryIds[0], toAmount: 10 }], false, prisma);

    expect(r.updated).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].id).toBe("batch");
    expect(r.errors[0].error.length).toBeGreaterThan(0);
    expect(r.batchId).toBeUndefined();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).description).toBe("a");
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batchesBefore);
  });

  it("updates an uncategorized entry without inventing a category in the answer", async () => {
    const a = await expense("sem categoria", null);
    const r = await bulkUpdateTransactions(USER, [{ id: a, description: "ainda sem" }], false, prisma);
    expect(r.errors).toEqual([]);
    expect(r.updated).toEqual([{ id: a, description: "ainda sem", category: undefined, amount: 10, operationId: null }]);
  });
});
