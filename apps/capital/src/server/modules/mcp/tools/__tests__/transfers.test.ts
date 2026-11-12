import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createTransfer, listLedgerAccounts, listTransfers } from "../transfers";

const USER = "test-user-mcp-transfers-001";
const OTHER = "test-user-mcp-transfers-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("MCP transfers", () => {
  it("lists checking, cash, and brokerage accounts and not the card or another user", async () => {
    const { accounts } = await listLedgerAccounts(USER, {}, prisma);
    const ids = accounts.map((account) => account.id);
    expect(ids).toEqual(expect.arrayContaining([f.pfChecking, f.pjChecking, f.broker]));
    expect(ids).not.toContain(f.card);
    expect(accounts.find((account) => account.id === f.pfChecking)).toMatchObject({
      type: "checking",
      entityId: f.pfId,
      entityKind: "personal",
      isDefault: true,
    });
    const brokers = await listLedgerAccounts(USER, { type: "brokerage" }, prisma);
    expect(brokers.accounts.map((account) => account.id)).toEqual([f.broker]);
    expect((await listLedgerAccounts(OTHER, {}, prisma)).accounts.every((account) => account.entityId !== f.pfId)).toBe(true);
  });

  it("creates an investment deposit, lists it, and returns the same one on a repeat", async () => {
    const created = await createTransfer(
      USER,
      { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10000, date: "2026-10-15", description: "Aporte XP" },
      prisma,
    );
    expect(created).toMatchObject({ duplicate: false, direction: "investment_deposit", description: "Aporte XP" });
    expect(created.batchId).toBeTruthy();
    const again = await createTransfer(
      USER,
      { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10000, date: "2026-10-15", description: "Aporte XP" },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, transferGroupId: created.transferGroupId, batchId: null });
    expect(await prisma.transferGroup.count({ where: { userId: USER, deletedAt: null } })).toBe(1);

    const listed = await listTransfers(USER, { accountId: f.broker, direction: "investment_deposit", entityId: f.pfId, dateFrom: "2026-10-01", dateTo: "2026-10-31" }, prisma);
    expect(listed.transfers).toEqual([
      expect.objectContaining({
        id: created.transferGroupId,
        fromAccountId: f.pfChecking,
        toAccountId: f.broker,
        fromAmount: 10000,
        toAmount: 10000,
        direction: "investment_deposit",
      }),
    ]);
    expect((await listTransfers(USER, { entityId: f.pjId }, prisma)).transfers).toHaveLength(0);
  });

  it("rejects a broker transfer across entities and pages the list", async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Nubank PJ", currency: "BRL" } });
    await expect(
      createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: pjBroker.id, amount: 100, date: "2026-10-15" }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "transfer.cross_entity_investment" });
    await expect(
      createTransfer(USER, { fromAccountId: pjBroker.id, toAccountId: f.pfChecking, amount: 100, date: "2026-10-15" }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "transfer.cross_entity_investment" });

    await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-10-14", description: "older" }, prisma);
    const newer = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 20, date: "2026-10-15", description: "newer" }, prisma);
    const both = await listTransfers(USER, { accountId: f.pfChecking, entityId: f.pfId }, prisma);
    expect(both.transfers.map((row) => row.id)).toContain(newer.transferGroupId);
    expect((await listTransfers(USER, { accountId: f.pfChecking, entityId: f.pjId }, prisma)).transfers).toHaveLength(0);
    const page = await listTransfers(USER, { limit: 1, offset: 1 }, prisma);
    expect(page).toMatchObject({ limit: 1, offset: 1 });
    expect(page.transfers).toHaveLength(1);
    expect(page.transfers[0].description).toBe("older");
  });

  it("rejects a card, a same-currency received amount, and another user's account", async () => {
    await expect(
      createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.card, amount: 100, date: "2026-10-15" }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "transfer.account_type" });
    await expect(
      createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-10-15", toAmount: 100 }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "transfer.same_currency" });
    await expect(
      createTransfer(OTHER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-10-15" }, prisma),
    ).rejects.toMatchObject({ status: 404, code: "transfer.from_account_not_found" });
  });

  it("books a cross-currency transfer at the amount that arrived", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Avenue", currency: "USD" } });
    const created = await createTransfer(
      USER,
      { fromAccountId: f.pfChecking, toAccountId: usd.id, amount: 5000, toAmount: 1000, date: "2026-10-15", description: "Câmbio" },
      prisma,
    );
    expect(created.direction).toBe("investment_deposit");
    const listed = await listTransfers(USER, { accountId: usd.id }, prisma);
    expect(listed.transfers[0]).toMatchObject({ fromAmount: 5000, fromCurrency: "BRL", toAmount: 1000, toCurrency: "USD" });
  });

  it("serializes a parallel double-submit into one transfer", async () => {
    const input = { fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 250, date: "2026-10-15", description: "Pró-labore" };
    const [a, b] = await Promise.all([createTransfer(USER, input, prisma), createTransfer(USER, input, prisma)]);
    expect([a, b].filter((row) => row.duplicate)).toHaveLength(1);
    expect(await prisma.transferGroup.count({ where: { userId: USER, deletedAt: null } })).toBe(1);
    expect([a, b].map((row) => row.direction)).toEqual(["profit_distribution", "profit_distribution"]);
  });
});

describe("MCP transfers: validation, defaults and duplicates", () => {
  it("needs two different accounts, and says which side is missing", async () => {
    await expect(createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.pfChecking, amount: 10, date: "2026-10-15" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "transfer.same_account",
    });
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: missing, amount: 10, date: "2026-10-15" }, prisma)).rejects.toMatchObject({
      status: 404,
      code: "transfer.to_account_not_found",
      message: expect.stringContaining("Destination account"),
    });
    await expect(createTransfer(USER, { fromAccountId: missing, toAccountId: f.pfChecking, amount: 10, date: "2026-10-15" }, prisma)).rejects.toMatchObject({
      status: 404,
      code: "transfer.from_account_not_found",
      message: expect.stringContaining("Source account"),
    });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("refuses an archived account on either side", async () => {
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await expect(createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-10-15" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "account.archived",
    });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("writes a default description from the direction and the account names, in the user's language", async () => {
    const pt = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-10-15" }, prisma);
    expect(pt.description).toBe("Aporte em investimento: Conta principal → XP");

    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    const en = await createTransfer(USER, { fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 10, date: "2026-10-15" }, prisma);
    expect(en.description).toBe("Profit distribution: Conta principal → Conta principal");

    const blank = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 10, date: "2026-10-16", description: "   " }, prisma);
    expect(blank.description).toBe("Capital injection: Conta principal → Conta principal");
  });

  it("treats a cross-currency repeat as a duplicate only when the received amount also matches", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Avenue", currency: "USD" } });
    const base = { fromAccountId: f.pfChecking, toAccountId: usd.id, date: "2026-10-15", description: "Câmbio" };

    const first = await createTransfer(USER, { ...base, amount: 5000, toAmount: 1000 }, prisma);
    expect(await createTransfer(USER, { ...base, amount: 5000, toAmount: 1000.005 }, prisma)).toMatchObject({ duplicate: true, transferGroupId: first.transferGroupId });
    // Same accounts, day and text, but a different amount that arrived: a second transfer.
    const otherRate = await createTransfer(USER, { ...base, amount: 5000, toAmount: 900 }, prisma);
    expect(otherRate.duplicate).toBe(false);
    expect(otherRate.transferGroupId).not.toBe(first.transferGroupId);
    // A different amount that left: also a second transfer.
    const otherAmount = await createTransfer(USER, { ...base, amount: 4000, toAmount: 1000 }, prisma);
    expect(otherAmount.duplicate).toBe(false);
    expect(await prisma.transferGroup.count({ where: { userId: USER, deletedAt: null } })).toBe(3);
  });

  it("does not mistake a transfer between other accounts, on the same day with the same text, for a repeat", async () => {
    const first = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-10-15", description: "Mesmo texto" }, prisma);
    const second = await createTransfer(USER, { fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 100, date: "2026-10-15", description: "Mesmo texto" }, prisma);
    expect(second.duplicate).toBe(false);
    expect(second.transferGroupId).not.toBe(first.transferGroupId);
  });

  it("derives the received amount from an exchange rate when none is given", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Avenue", currency: "USD" } });
    const created = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: usd.id, amount: 5000, exchangeRate: 5, date: "2026-10-15", description: "Câmbio" }, prisma);
    expect(created.duplicate).toBe(false);
    const listed = await listTransfers(USER, { accountId: usd.id }, prisma);
    expect(listed.transfers[0]).toMatchObject({ fromAmount: 5000, fromCurrency: "BRL", toCurrency: "USD" });
    expect(listed.transfers[0].toAmount).toBeGreaterThan(0);
  });

  it("does not list a transfer that lost a leg", async () => {
    const created = await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-10-15", description: "perna solta" }, prisma);
    expect(created.entryIds).toHaveLength(2);
    await prisma.ledgerEntry.update({ where: { id: created.entryIds[1] }, data: { deletedAt: new Date() } });
    expect((await listTransfers(USER, {}, prisma)).transfers).toEqual([]);
    expect(await prisma.transferGroup.count({ where: { id: created.transferGroupId! } })).toBe(1);
  });

  it("clamps the page size to 1-500 and the offset to 0 or more, truncating fractions", async () => {
    expect(await listTransfers(USER, { limit: 0, offset: -5 }, prisma)).toMatchObject({ limit: 1, offset: 0 });
    expect(await listTransfers(USER, { limit: 9999 }, prisma)).toMatchObject({ limit: 500, offset: 0 });
    expect(await listTransfers(USER, { limit: 2.9, offset: 1.7 }, prisma)).toMatchObject({ limit: 2, offset: 1 });
    expect(await listTransfers(USER, {}, prisma)).toMatchObject({ limit: 100, offset: 0 });
  });

  it("filters by date range, one bound at a time", async () => {
    await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 1, date: "2026-09-10", description: "setembro" }, prisma);
    await createTransfer(USER, { fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 2, date: "2026-11-10", description: "novembro" }, prisma);
    const descriptions = async (params: Parameters<typeof listTransfers>[1]) => (await listTransfers(USER, params, prisma)).transfers.map((t) => t.description);

    expect(await descriptions({ dateFrom: "2026-10-01" })).toEqual(["novembro"]);
    expect(await descriptions({ dateTo: "2026-10-01" })).toEqual(["setembro"]);
    expect(await descriptions({ dateFrom: "2026-09-10", dateTo: "2026-11-10" })).toEqual(["novembro", "setembro"]);
  });
});
