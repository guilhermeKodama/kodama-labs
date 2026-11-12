import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { searchBillTransactionsForAgent, searchTransactionsForAgent, searchTransfersForAgent } from "../queries/search-for-agent";

const USER = "test-user-assistant-data-search";
const OTHER = "test-user-assistant-data-search-other";
const day = parseLocalDate;

let f: LedgerFixture;
let importId: string;
let mercadoId: string;
let salaryId: string;
let figmaId: string;
let padariaId: string;
let secondCard: string;

beforeAll(async () => {
  await prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  f = await createLedgerFixture(prisma, USER);
  const other = await createLedgerFixture(prisma, OTHER);

  const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pjId, transactionCount: 1, bankName: "Banco X" } });
  importId = imp.id;

  const create = async (input: Parameters<typeof createEntry>[1], opts: Parameters<typeof createEntry>[3] = {}) => (await createEntry(USER, input, prisma, opts)).entryIds[0];
  mercadoId = await create({ kind: "expense", accountId: f.pfChecking, amount: 120.5, date: "2026-09-02", description: "Mercado Zona Sul", categoryId: f.categories.Groceries, externalId: "ext-mercado" });
  salaryId = await create({ kind: "income", accountId: f.pfChecking, amount: 5000, date: "2026-09-05", description: "Salario Kodama", categoryId: f.categories.Salary, externalId: "ext-salary" });
  figmaId = await create({ kind: "expense", accountId: f.pjChecking, amount: 45, date: "2026-09-10", description: "Assinatura Figma", categoryId: f.categories.Software, externalId: "ext-figma" }, { importId });
  padariaId = await create({ kind: "expense", accountId: f.pfChecking, amount: 18, date: "2026-08-20", description: "Padaria do Ze" });

  await prisma.attachment.create({
    data: { kind: "RECEIPT", blobUrl: "blob://r1", pathname: "r1.png", mimeType: "image/png", sizeBytes: 10, originalName: "r1.png", ledgerEntryId: mercadoId },
  });

  // Transfers: personal -> business, personal -> brokerage, and one with no legs at all.
  const toBusiness = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 300, date: "2026-09-15", description: "Aporte na empresa" }, prisma);
  await prisma.transferGroup.update({ where: { id: toBusiness.transferGroupId! }, data: { externalId: "ext-aporte" } });
  const toBroker = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 500, date: "2026-09-20", description: "Aplicacao XP" }, prisma);
  await prisma.transferGroup.update({ where: { id: toBroker.transferGroupId! }, data: { externalId: "ext-xp" } });
  await prisma.transferGroup.create({ data: { userId: USER, direction: "between_accounts", date: day("2026-09-25"), description: "Grupo sem pernas", externalId: "ext-empty" } });
  // Another user's transfer must never show up.
  await createEntry(OTHER, { kind: "transfer", fromAccountId: other.pfChecking, toAccountId: other.pjChecking, amount: 999, date: "2026-09-15", description: "Aporte alheio" }, prisma);
  await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 77, date: "2026-09-02", description: "Mercado alheio" }, prisma);

  // Card purchases on the fixture card (Nubank, closes on the 5th) and on a second card.
  const second = await prisma.account.create({
    data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Inter", currency: "BRL", externalId: "9999", creditLimit: 5000, closingDay: 20, dueDay: 27 },
  });
  secondCard = second.id;
  await importCardStatement(
    USER,
    {
      accountId: f.card,
      month: "2026-09",
      fallback: "none",
      rows: [
        { date: "2026-08-10", description: "UBER *TRIP", amount: 40, category: "Software", merchantName: "Uber" },
        { date: "2026-08-12", description: "PAO DE ACUCAR", amount: 150, category: "Groceries" },
        { date: "2026-08-15", description: "LOJA SEM CATEGORIA", amount: 15 },
        { date: "2026-08-20", description: "TV SAMSUNG", amount: 300, installment: { number: 1, total: 3 }, category: "Groceries" },
      ],
    },
    prisma
  );
  await importCardStatement(USER, { accountId: secondCard, month: "2026-09", fallback: "none", rows: [{ date: "2026-08-25", description: "CINEMA", amount: 60, category: "Software" }] }, prisma);
});

afterAll(async () => {
  await prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("searchTransactionsForAgent", () => {
  const search = (filters: Partial<Parameters<typeof searchTransactionsForAgent>[1]> = {}) => searchTransactionsForAgent(USER, { limit: 50, ...filters }, prisma);
  const names = (r: Awaited<ReturnType<typeof search>>) => r.rows.map((x) => x.description);

  it("lists the user's income/expense entries newest first with positive amounts, never transfer legs or other users' rows", async () => {
    const r = await search();
    // 4 checking entries + 4 Nubank purchases + 2 projected installments + 1 Inter purchase.
    expect(r.total).toBe(11);
    expect(r.rows).toHaveLength(11);
    expect(names(r)).not.toContain("Aporte na empresa");
    expect(names(r)).not.toContain("Aplicacao XP");
    expect(names(r).some((d) => d.includes("alheio"))).toBe(false);
    const dates = r.rows.map((x) => x.date.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(r.rows.every((x) => x.amount >= 0)).toBe(true);
    expect(r.rows.find((x) => x.id === mercadoId)).toMatchObject({
      description: "Mercado Zona Sul",
      amount: 120.5,
      type: "expense",
      category: "Groceries",
      accountId: f.pfChecking,
      externalId: "ext-mercado",
      statementImportId: null,
      _count: { attachments: 1 },
    });
    expect(r.rows.find((x) => x.id === padariaId)).toMatchObject({ category: null, externalId: null, _count: { attachments: 0 } });
  });

  it("filters by kind", async () => {
    const income = await search({ type: "income" });
    expect(income.rows.map((x) => x.id)).toEqual([salaryId]);
    expect(income.rows[0]).toMatchObject({ type: "income", amount: 5000, category: "Salary" });
    const investment = await search({ type: "investment" });
    expect(investment).toEqual({ total: 0, rows: [] });
  });

  it("filters by entity kind and by entity id", async () => {
    expect((await search({ entityType: "business" })).rows.map((x) => x.id)).toEqual([figmaId]);
    expect(names(await search({ entityId: f.pjId }))).toEqual(["Assinatura Figma"]);
    const personal = await search({ entityType: "personal", entityId: f.pfId, descriptionContains: "a" });
    expect(personal.rows.every((x) => x.id !== figmaId)).toBe(true);
    expect(await search({ entityType: "business", entityId: f.pfId })).toEqual({ total: 0, rows: [] });
  });

  it("filters by statement import and by external ids (an empty list filters nothing)", async () => {
    const imported = await search({ statementImportId: importId });
    expect(imported.rows.map((x) => x.id)).toEqual([figmaId]);
    expect(imported.rows[0].statementImportId).toBe(importId);

    const byExternal = await search({ externalIds: ["ext-mercado", "ext-salary", "ext-nope"] });
    expect(byExternal.rows.map((x) => x.id).sort()).toEqual([mercadoId, salaryId].sort());

    expect((await search({ externalIds: [] })).total).toBe(11);
  });

  it("matches the description case-insensitively", async () => {
    expect(names(await search({ descriptionContains: "zona SUL" }))).toEqual(["Mercado Zona Sul"]);
    expect(await search({ descriptionContains: "inexistente" })).toEqual({ total: 0, rows: [] });
  });

  it("bounds the date with from, to or both, inclusive on the given day", async () => {
    const from = await search({ entityId: f.pfId, dateFrom: day("2026-09-03") });
    expect(from.rows.map((x) => x.id)).toEqual([salaryId]);
    expect((await search({ entityId: f.pfId, dateFrom: day("2026-09-05") })).rows.map((x) => x.id)).toEqual([salaryId]);
    expect((await search({ entityId: f.pfId, dateFrom: day("2026-09-06") })).total).toBe(0);

    expect((await search({ descriptionContains: "padaria", dateTo: day("2026-08-20") })).rows.map((x) => x.id)).toEqual([padariaId]);
    expect((await search({ descriptionContains: "padaria", dateTo: day("2026-08-19") })).total).toBe(0);

    const both = await search({ entityId: f.pfId, dateFrom: day("2026-09-02"), dateTo: day("2026-09-05") });
    expect(both.rows.map((x) => x.id)).toEqual([salaryId, mercadoId]);
  });

  it("applies amount limits to the magnitude, for incomes and expenses alike", async () => {
    const mine = ["ext-mercado", "ext-salary", "ext-figma"]; // 120.50 expense, 5000 income, 45 expense
    const ids = async (filters: Parameters<typeof search>[0]) => (await search({ externalIds: mine, ...filters })).rows.map((x) => x.id).sort();
    expect(await ids({ amountMin: 100 })).toEqual([mercadoId, salaryId].sort());
    // Only an upper limit: a 45 expense is within it, so it must be found.
    // (The upper limit alone currently also lets bigger rows through; see the report.)
    expect(await ids({ amountMax: 50 })).toContain(figmaId);
    expect(await ids({ amountMin: 100, amountMax: 200 })).toEqual([mercadoId]);
    expect(await ids({ amountMin: 45, amountMax: 45 })).toEqual([figmaId]);
    expect(await ids({ amountMin: 0, amountMax: 40 })).toEqual([]);
    expect(await ids({ amountMin: 0, amountMax: 50 })).toEqual([figmaId]);
    // 0 is a limit like any other, not "unset".
    expect(await ids({ amountMin: 0 })).toHaveLength(3);
    expect(await ids({ amountMin: 6000 })).toEqual([]);
  });

  it("pages with limit and offset while total counts the whole match", async () => {
    const page1 = await search({ entityId: f.pfId, limit: 2 });
    const page2 = await search({ entityId: f.pfId, limit: 2, offset: 2 });
    expect(page1.total).toBeGreaterThan(2);
    expect(page2.total).toBe(page1.total);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows.map((x) => x.id)).not.toEqual(page1.rows.map((x) => x.id));
    expect(new Set([...page1.rows, ...page2.rows].map((x) => x.id)).size).toBe(page1.rows.length + page2.rows.length);
  });
});

describe("searchTransfersForAgent", () => {
  const search = (filters: Partial<Parameters<typeof searchTransfersForAgent>[1]> = {}) => searchTransfersForAgent(USER, { limit: 50, ...filters }, prisma);

  it("reports each transfer in the legacy from/to shape, newest first, only for the user", async () => {
    const r = await search();
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.description)).toEqual(["Grupo sem pernas", "Aplicacao XP", "Aporte na empresa"]);

    const toBusiness = r.rows[2];
    expect(toBusiness).toMatchObject({
      amount: 300,
      direction: "capital_injection",
      externalId: "ext-aporte",
      fromAccountId: f.pfChecking,
      toAccountId: f.pjChecking,
      fromPersonalAccountId: f.pfId,
      fromBusinessId: null,
      fromInvestmentAccountId: null,
      toBusinessId: f.pjId,
      toPersonalAccountId: null,
      toInvestmentAccountId: null,
    });

    // The brokerage side is the investment account, not the entity that owns it.
    expect(r.rows[1]).toMatchObject({
      amount: 500,
      direction: "investment_deposit",
      fromPersonalAccountId: f.pfId,
      toInvestmentAccountId: f.broker,
      toPersonalAccountId: null,
      toBusinessId: null,
    });
  });

  it("copes with a transfer group that has no legs", async () => {
    const empty = (await search({ externalIds: ["ext-empty"] })).rows[0];
    expect(empty).toMatchObject({
      amount: 0,
      fromAccountId: null,
      toAccountId: null,
      fromBusinessId: null,
      fromPersonalAccountId: null,
      fromInvestmentAccountId: null,
      toBusinessId: null,
      toPersonalAccountId: null,
      toInvestmentAccountId: null,
    });
  });

  it("filters by entity, entity kind, external ids and dates", async () => {
    expect((await search({ entityId: f.pjId })).rows.map((x) => x.description)).toEqual(["Aporte na empresa"]);
    expect((await search({ entityType: "business" })).rows.map((x) => x.description)).toEqual(["Aporte na empresa"]);
    expect((await search({ entityType: "business", entityId: f.pfId })).total).toBe(0);
    expect((await search({ externalIds: ["ext-xp"] })).rows.map((x) => x.description)).toEqual(["Aplicacao XP"]);
    expect((await search({ externalIds: [] })).total).toBe(3);
    expect((await search({ dateFrom: day("2026-09-18") })).rows.map((x) => x.description)).toEqual(["Grupo sem pernas", "Aplicacao XP"]);
    expect((await search({ dateTo: day("2026-09-16") })).rows.map((x) => x.description)).toEqual(["Aporte na empresa"]);
    expect((await search({ dateFrom: day("2026-09-16"), dateTo: day("2026-09-21") })).rows.map((x) => x.description)).toEqual(["Aplicacao XP"]);
  });

  it("pages with limit and offset", async () => {
    const r = await search({ limit: 1, offset: 1 });
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.description)).toEqual(["Aplicacao XP"]);
  });
});

describe("searchBillTransactionsForAgent", () => {
  const search = (filters: Partial<Parameters<typeof searchBillTransactionsForAgent>[1]> = {}) => searchBillTransactionsForAgent(USER, { limit: 50, ...filters }, prisma);

  it("lists card purchases as positive charges with a category breakdown over the whole set, leaving projected installments out", async () => {
    const r = await search();
    // 4 Nubank purchases + 1 Inter purchase; the 2 projected installments are not purchases yet.
    expect(r.total).toBe(5);
    expect(r.rows.map((x) => x.description)).not.toContain("TV SAMSUNG (2/3)");
    expect(r.byCategory).toEqual([
      { category: "Groceries", totalAmount: 450, count: 2 },
      { category: "Software", totalAmount: 100, count: 2 },
      { category: null, totalAmount: 15, count: 1 },
    ]);
    const uber = r.rows.find((x) => x.description === "UBER *TRIP");
    expect(uber).toMatchObject({ amount: 40, category: "Software", merchantName: "Uber", installmentNumber: null, totalInstallments: null });
    const tv = r.rows.find((x) => x.description === "TV SAMSUNG");
    expect(tv).toMatchObject({ amount: 300, installmentNumber: 1, totalInstallments: 3 });
    expect(r.rows.find((x) => x.description === "LOJA SEM CATEGORIA")?.category).toBeNull();
  });

  it("filters by card, bill, category and description", async () => {
    const inter = await search({ creditCardId: secondCard });
    expect(inter.rows.map((x) => x.description)).toEqual(["CINEMA"]);
    expect(inter.byCategory).toEqual([{ category: "Software", totalAmount: 60, count: 1 }]);

    const billId = (await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } })).id;
    const bill = await search({ billId });
    expect(bill.total).toBe(4);
    expect(bill.rows.every((x) => x.billId === billId)).toBe(true);

    expect((await search({ category: "Groceries" })).rows.map((x) => x.description).sort()).toEqual(["PAO DE ACUCAR", "TV SAMSUNG"]);
    expect((await search({ descriptionContains: "uber" })).rows.map((x) => x.description)).toEqual(["UBER *TRIP"]);
    expect(await search({ category: "Nope" })).toEqual({ total: 0, rows: [], byCategory: [] });
  });

  it("bounds by purchase date and pages while the breakdown stays whole", async () => {
    const window = await search({ dateFrom: day("2026-08-11"), dateTo: day("2026-08-15") });
    expect(window.rows.map((x) => x.description)).toEqual(["LOJA SEM CATEGORIA", "PAO DE ACUCAR"]);
    expect((await search({ dateFrom: day("2026-08-20") })).rows.map((x) => x.description)).toEqual(["CINEMA", "TV SAMSUNG"]);
    expect((await search({ dateTo: day("2026-08-10") })).rows.map((x) => x.description)).toEqual(["UBER *TRIP"]);

    const page = await search({ limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);
    expect(page.byCategory.reduce((sum, g) => sum + g.count, 0)).toBe(5);
  });

  it("never sees another user's card purchases", async () => {
    const r = await searchBillTransactionsForAgent(OTHER, { limit: 50 }, prisma);
    expect(r).toEqual({ total: 0, rows: [], byCategory: [] });
  });
});
