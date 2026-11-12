import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { bulkCreateTransactions } from "../bulk-create-transactions";

const USER = "test-user-mcp-bulk-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Dividends", type: "income" }, { name: "Software", type: "expense" }] });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const dividend = (overrides: Record<string, unknown> = {}) => ({
  entityType: "personal" as const,
  type: "income" as const,
  amount: 50.75,
  currency: "BRL",
  description: "PMLL11 - Dividends September 2026",
  category: "Dividends",
  date: "2026-09-15",
  personalAccountId: f.pfId,
  ...overrides,
});

const entries = () => prisma.ledgerEntry.findMany({ where: { userId: USER }, orderBy: { date: "asc" } });

describe("MCP bulk create transactions", () => {
  it("previews in dry-run mode without writing", async () => {
    const r = await bulkCreateTransactions(USER, [dividend(), dividend({ description: "PVBI11 - Dividends", amount: 35.2, date: "2026-09-20" })], true, prisma);
    expect(r.created.map((c) => c.id)).toEqual(["dry-run", "dry-run"]);
    expect(r.duplicates).toEqual([]);
    expect(await entries()).toHaveLength(0);
  });

  it("creates entries on the entity's main account as one undoable batch", async () => {
    const r = await bulkCreateTransactions(USER, [dividend(), dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Figma", amount: 80 })], false, prisma);
    expect(r.created).toHaveLength(2);
    expect(r.errors).toEqual([]);
    expect(r.created.map((row) => [row.accountId, row.accountName]).sort()).toEqual(
      [
        [f.pfChecking, "Conta principal"],
        [f.pjChecking, "Conta principal"],
      ].sort(),
    );
    const rows = await entries();
    // Both rows share a date, so the order they come back in is not fixed.
    expect(rows.map((e) => [e.accountId, Number(e.amount), e.kind]).sort()).toEqual(
      [
        [f.pfChecking, 50.75, "income"],
        [f.pjChecking, -80, "expense"],
      ].sort()
    );
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(1);
  });

  it("detects duplicates against existing entries and within the batch (case-insensitive, trimmed)", async () => {
    await bulkCreateTransactions(USER, [dividend()], false, prisma);
    const r = await bulkCreateTransactions(
      USER,
      [dividend({ description: "  pmll11 - DIVIDENDS september 2026 " }), dividend({ description: "New", amount: 1 }), dividend({ description: "New", amount: 1 })],
      false,
      prisma
    );
    expect(r.created.map((c) => c.description)).toEqual(["New"]);
    expect(r.duplicates.map((d) => d.existingId === "within-batch")).toEqual([false, true]);
  });

  it("stores dates at noon UTC", async () => {
    await bulkCreateTransactions(USER, [dividend({ date: "2026-09-15T03:00:00.000Z" })], false, prisma);
    expect((await entries())[0].date.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("canonicalizes category names and rejects unknown ones with suggestions", async () => {
    const r = await bulkCreateTransactions(USER, [dividend({ category: "dividends" })], false, prisma);
    expect(r.created).toHaveLength(1);
    expect((await entries())[0].categoryId).toBe(f.categories.Dividends);
    await expect(bulkCreateTransactions(USER, [dividend({ category: "Dividendz" })], false, prisma)).rejects.toThrow(/Did you mean: Dividends/);
  });

  it("reports per-item errors and keeps going", async () => {
    const r = await bulkCreateTransactions(USER, [dividend({ personalAccountId: "00000000-0000-0000-0000-000000000000" }), dividend({ description: "ok" })], false, prisma);
    expect(r.errors).toHaveLength(1);
    expect(r.created.map((c) => c.description)).toEqual(["ok"]);
  });

  it("books investment-type rows as investment outflows", async () => {
    await prisma.category.create({ data: { userId: USER, name: "Stocks", type: "investment" } });
    await bulkCreateTransactions(USER, [dividend({ type: "investment", category: "Stocks", description: "Aporte", amount: 1000 })], false, prisma);
    const [e] = await entries();
    expect([e.kind, Number(e.amount)]).toEqual(["investment", -1000]);
  });

  it("books a row on the given account and leaves the main account alone", async () => {
    const inter = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Inter PJ", currency: "BRL" } });
    const nu = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Nu Empresas", currency: "BRL" } });
    const r = await bulkCreateTransactions(
      USER,
      [
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Tarifa Inter", amount: 15, accountId: inter.id }),
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Tarifa Nu", amount: 15, accountId: nu.id }),
        dividend({ description: "Sem conta" }),
      ],
      false,
      prisma,
    );
    expect(r.errors).toEqual([]);
    expect(r.created.map((row) => [row.description, row.accountId, row.accountName]).sort()).toEqual(
      [
        ["Sem conta", f.pfChecking, "Conta principal"],
        ["Tarifa Inter", inter.id, "Inter PJ"],
        ["Tarifa Nu", nu.id, "Nu Empresas"],
      ].sort(),
    );
    expect(await prisma.ledgerEntry.count({ where: { accountId: f.pjChecking } })).toBe(0);
  });

  it("rejects a missing, archived, or other-entity account on that item only", async () => {
    const archived = await prisma.account.create({
      data: { userId: USER, entityId: f.pjId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() },
    });
    const r = await bulkCreateTransactions(
      USER,
      [
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, description: "Sumiu", accountId: "00000000-0000-0000-0000-000000000000" }),
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, description: "Arquivada", accountId: archived.id }),
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, description: "Outra entidade", accountId: f.pfChecking }),
        dividend({ description: "ok" }),
      ],
      false,
      prisma,
    );
    expect(r.created.map((row) => row.description)).toEqual(["ok"]);
    expect(r.errors.map((row) => row.error)).toEqual([
      "Account not found or access denied",
      'Account "Antiga" is archived and cannot receive transactions',
      'Account "Conta principal" belongs to a different entity than this transaction',
    ]);
    expect(await prisma.ledgerEntry.count({ where: { accountId: { in: [archived.id, f.pfChecking] } } })).toBe(1);
  });

  it("dedupes an explicit account only against that account", async () => {
    const inter = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Inter PJ", currency: "BRL" } });
    const nu = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "checking", name: "Nu Empresas", currency: "BRL" } });
    const first = await bulkCreateTransactions(
      USER,
      [dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Tarifa", amount: 10, accountId: inter.id })],
      false,
      prisma,
    );
    const second = await bulkCreateTransactions(
      USER,
      [
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Tarifa", amount: 10, accountId: inter.id }),
        dividend({ entityType: "business", personalAccountId: undefined, businessId: f.pjId, type: "expense", category: "Software", description: "Tarifa", amount: 10, accountId: nu.id }),
      ],
      false,
      prisma,
    );
    expect(second.duplicates.map((row) => row.existingId)).toEqual([first.created[0].id]);
    expect(second.created.map((row) => row.accountId)).toEqual([nu.id]);
  });
});

describe("MCP bulk create edge cases", () => {
  it("does nothing for an empty list", async () => {
    expect(await bulkCreateTransactions(USER, [], false, prisma)).toEqual({ created: [], duplicates: [], errors: [] });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(0);
  });

  it("writes nothing when every row is a duplicate", async () => {
    await bulkCreateTransactions(USER, [dividend()], false, prisma);
    const batchesBefore = await prisma.mutationBatch.count({ where: { userId: USER } });
    const r = await bulkCreateTransactions(USER, [dividend()], false, prisma);
    expect(r.created).toEqual([]);
    expect(r.duplicates).toHaveLength(1);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batchesBefore);
  });
});
