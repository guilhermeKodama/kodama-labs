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
