import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { moveBrokerageCash } from "../portfolio";

const USER = "test-user-inv-cashmoves-001";
let f: LedgerFixture;
let pfUsd: Account;
let pjBroker: Account;
let pjUsdBroker: Account;
let pjEurBroker: Account;
let usdBroker: Account;

beforeEach(async () => {
  // 1 USD = 5 BRL, 1 EUR = 10 BRL.
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  await prisma.currency.create({ data: { userId: USER, code: "EUR", name: "Euro", symbol: "E", manualRate: 0.1 } });
  const account = (entityId: string, type: "checking" | "brokerage", name: string, currency: string) =>
    prisma.account.create({ data: { userId: USER, entityId, type, name, currency } });
  pfUsd = await account(f.pfId, "checking", "Conta USD", "USD");
  usdBroker = await account(f.pfId, "brokerage", "IBKR", "USD");
  pjBroker = await account(f.pjId, "brokerage", "BTG", "BRL");
  pjUsdBroker = await account(f.pjId, "brokerage", "BTG USD", "USD");
  pjEurBroker = await account(f.pjId, "brokerage", "BTG EUR", "EUR");
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId) ?? 0;

/** [account, currency, amount] of every leg of a transfer group, debit first. */
async function legs(transferGroupId: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { transferGroupId }, orderBy: { amount: "asc" } });
  return rows.map((r) => [r.accountId, r.currency, toNumber(r.amount)]);
}

const deposit = (accountId: string, amount: number, extra: Partial<Parameters<typeof moveBrokerageCash>[1]> = {}) =>
  moveBrokerageCash(USER, { accountId, amount, date: "2026-09-01", direction: "deposit", ...extra }, prisma);
const withdraw = (accountId: string, amount: number, extra: Partial<Parameters<typeof moveBrokerageCash>[1]> = {}) =>
  moveBrokerageCash(USER, { accountId, amount, date: "2026-09-02", direction: "withdraw", ...extra }, prisma);

describe("moveBrokerageCash inside one entity", () => {
  it("deposits from the entity's main checking and withdraws back to it, as one investment transfer each", async () => {
    const dep = await deposit(f.broker, 1000);
    expect(dep.transferGroupIds).toHaveLength(1);
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -1000],
      [f.broker, "BRL", 1000],
    ]);
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: dep.transferGroupIds[0] } })).direction).toBe("investment_deposit");

    const out = await withdraw(f.broker, 400, { description: "Resgate parcial" });
    expect(await legs(out.transferGroupIds[0])).toEqual([
      [f.broker, "BRL", -400],
      [f.pfChecking, "BRL", 400],
    ]);
    expect(await balance(f.broker)).toBe(600);
    expect(await balance(f.pfChecking)).toBe(-600);
    const outGroup = await prisma.transferGroup.findUniqueOrThrow({ where: { id: out.transferGroupIds[0] } });
    expect(outGroup).toMatchObject({ description: "Resgate parcial", direction: "investment_withdrawal" });
  });

  it("refuses a withdrawal above the broker's cash, including from a broker that never had any", async () => {
    await expect(withdraw(f.broker, 1)).rejects.toMatchObject({ status: 422, code: "brokerage.insufficient_cash" });
    await deposit(f.broker, 100);
    await expect(withdraw(f.broker, 100.01)).rejects.toMatchObject({ status: 422, code: "brokerage.insufficient_cash" });
    expect(await withdraw(f.broker, 100)).toMatchObject({ transferGroupIds: [expect.any(String)] });
    expect(await balance(f.broker)).toBe(0);
  });

  it("refuses an account that is not a brokerage", async () => {
    await expect(deposit(f.pfChecking, 10)).rejects.toMatchObject({ status: 422, code: "holding.requires_brokerage" });
  });

  it("uses the counterpart account when one is named", async () => {
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Reserva", currency: "BRL" } });
    const dep = await deposit(f.broker, 250, { counterpartAccountId: savings.id });
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [savings.id, "BRL", -250],
      [f.broker, "BRL", 250],
    ]);
  });

  it("converts across currencies with the amount received when the broker is in another currency, and ignores a received amount in the same currency", async () => {
    // R$ 500 leave the checking, US$ 100 arrive.
    const dep = await deposit(usdBroker.id, 500, { toAmount: 100 });
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -500],
      [usdBroker.id, "USD", 100],
    ]);

    const same = await deposit(f.broker, 300, { toAmount: 999 });
    expect(await legs(same.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -300],
      [f.broker, "BRL", 300],
    ]);

    // A zero received amount is not an amount: the broker leg is converted at the stored rate of the day instead of being left at 0.
    const zero = await deposit(usdBroker.id, 500, { toAmount: 0 });
    const [debit, credit] = await legs(zero.transferGroupIds[0]);
    expect(debit).toEqual([f.pfChecking, "BRL", -500]);
    expect(credit[1]).toBe("USD");
    expect(credit[2] as number).toBeGreaterThan(0);
  });
});

describe("moveBrokerageCash across entities", () => {
  it("deposits a PF checking into a PJ broker through the PJ's main checking, in one undo batch", async () => {
    const dep = await deposit(pjBroker.id, 1000, { counterpartAccountId: f.pfChecking });
    expect(dep.transferGroupIds).toHaveLength(2);
    expect(dep.transferGroupId).toBe(dep.transferGroupIds[1]);
    expect(dep.batchId).not.toBeNull();
    expect(dep.entryIds).toHaveLength(4);
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -1000],
      [f.pjChecking, "BRL", 1000],
    ]);
    expect(await legs(dep.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -1000],
      [pjBroker.id, "BRL", 1000],
    ]);
    expect(await balance(pjBroker.id)).toBe(1000);
    expect(await balance(f.pjChecking)).toBe(0);
    expect(await balance(f.pfChecking)).toBe(-1000);

    await undoBatch(USER, dep.batchId!, prisma);
    expect(await balance(pjBroker.id)).toBe(0);
    expect(await balance(f.pfChecking)).toBe(0);
  });

  it("treats a cash account in another entity like a checking one", async () => {
    const wallet = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    const dep = await deposit(pjBroker.id, 300, { counterpartAccountId: wallet.id });
    expect(dep.transferGroupIds).toHaveLength(2);
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [wallet.id, "BRL", -300],
      [f.pjChecking, "BRL", 300],
    ]);
    expect(await balance(pjBroker.id)).toBe(300);
  });

  it("withdraws a PJ broker into a PF checking, and records the profit distribution as its own transfer", async () => {
    await deposit(pjBroker.id, 1000, { counterpartAccountId: f.pfChecking });
    const out = await withdraw(pjBroker.id, 400, { counterpartAccountId: f.pfChecking });
    expect(out.transferGroupIds).toHaveLength(2);
    expect(out.transferGroupId).toBe(out.transferGroupIds[0]);
    expect(await legs(out.transferGroupIds[0])).toEqual([
      [pjBroker.id, "BRL", -400],
      [f.pjChecking, "BRL", 400],
    ]);
    expect(await legs(out.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -400],
      [f.pfChecking, "BRL", 400],
    ]);
    expect(await balance(pjBroker.id)).toBe(600);
    expect(await balance(f.pfChecking)).toBe(-600);
  });

  it("creates the broker entity's main checking when it has none, inside the batch, so undo removes it too", async () => {
    const lonely = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Nova LTDA", defaultCurrency: "BRL" } });
    const broker = await prisma.account.create({ data: { userId: USER, entityId: lonely.id, type: "brokerage", name: "Clear", currency: "BRL" } });
    expect(await prisma.account.count({ where: { entityId: lonely.id, isDefault: true } })).toBe(0);

    const dep = await deposit(broker.id, 700, { counterpartAccountId: f.pfChecking });
    const main = await prisma.account.findFirstOrThrow({ where: { entityId: lonely.id, isDefault: true } });
    expect(main.type).toBe("checking");
    expect(await legs(dep.transferGroupIds[1])).toEqual([
      [main.id, "BRL", -700],
      [broker.id, "BRL", 700],
    ]);

    await undoBatch(USER, dep.batchId!, prisma);
    expect(await prisma.account.count({ where: { id: main.id } })).toBe(0);
    expect(await balance(broker.id)).toBe(0);
  });

  it("books each leg in its own account's currency when a USD checking funds a BRL broker: the broker gets exactly the amount", async () => {
    // R$ 100 into the PJ broker; at 1 USD = 5 BRL that is US$ 20 from the PF's USD account.
    const dep = await deposit(pjBroker.id, 100, { counterpartAccountId: pfUsd.id });
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [pfUsd.id, "USD", -20],
      [f.pjChecking, "BRL", 100],
    ]);
    expect(await legs(dep.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -100],
      [pjBroker.id, "BRL", 100],
    ]);
  });

  it("converts through the main checking when source, checking and broker are in three different currencies", async () => {
    // US$ 50 leave the PF's USD account, 10 EUR arrive in the PJ's EUR broker; the PJ's BRL checking sits between (50 USD = R$ 250).
    const dep = await deposit(pjEurBroker.id, 50, { counterpartAccountId: pfUsd.id, toAmount: 10 });
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [pfUsd.id, "USD", -50],
      [f.pjChecking, "BRL", 250],
    ]);
    expect(await legs(dep.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -250],
      [pjEurBroker.id, "EUR", 10],
    ]);
  });

  it("treats the amount as the broker's own when no received amount is given for a BRL checking", async () => {
    // A USD broker funded from the PF's BRL checking with no toAmount: the amount is the broker's (US$ 100).
    const dep = await deposit(pjUsdBroker.id, 100, { counterpartAccountId: f.pfChecking });
    expect(await legs(dep.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -500],
      [f.pjChecking, "BRL", 500],
    ]);
    expect(await legs(dep.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -500],
      [pjUsdBroker.id, "USD", 100],
    ]);
  });

  it("withdraws a USD broker into a BRL account at today's rate, or at the amount actually received", async () => {
    await deposit(pjUsdBroker.id, 300, { counterpartAccountId: f.pfChecking });
    const atRate = await withdraw(pjUsdBroker.id, 100, { counterpartAccountId: f.pfChecking });
    expect(await legs(atRate.transferGroupIds[0])).toEqual([
      [pjUsdBroker.id, "USD", -100],
      [f.pjChecking, "BRL", 500],
    ]);
    expect(await legs(atRate.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -500],
      [f.pfChecking, "BRL", 500],
    ]);

    // The bank only credited R$ 480.
    const received = await withdraw(pjUsdBroker.id, 100, { counterpartAccountId: f.pfChecking, toAmount: 480 });
    expect(await legs(received.transferGroupIds[0])).toEqual([
      [pjUsdBroker.id, "USD", -100],
      [f.pjChecking, "BRL", 480],
    ]);
    expect(await legs(received.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -480],
      [f.pfChecking, "BRL", 480],
    ]);
  });

  it("withdraws a BRL broker into a USD account, converting only on the last hop", async () => {
    await deposit(pjBroker.id, 1000, { counterpartAccountId: f.pfChecking });
    const out = await withdraw(pjBroker.id, 500, { counterpartAccountId: pfUsd.id });
    expect(await legs(out.transferGroupIds[0])).toEqual([
      [pjBroker.id, "BRL", -500],
      [f.pjChecking, "BRL", 500],
    ]);
    expect(await legs(out.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -500],
      [pfUsd.id, "USD", 100],
    ]);
  });

  it("converts through the main checking when the broker, the checking and the destination are in three currencies", async () => {
    await deposit(pjEurBroker.id, 50, { counterpartAccountId: pfUsd.id, toAmount: 10 });
    // 5 EUR out of the broker, US$ 12 received (a worse rate than 1 EUR = 2 USD): the BRL checking sits between at R$ 60.
    const received = await withdraw(pjEurBroker.id, 5, { counterpartAccountId: pfUsd.id, toAmount: 12 });
    expect(await legs(received.transferGroupIds[0])).toEqual([
      [pjEurBroker.id, "EUR", -5],
      [f.pjChecking, "BRL", 60],
    ]);
    expect(await legs(received.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -60],
      [pfUsd.id, "USD", 12],
    ]);

    // Without the received amount the hop converts EUR to the checking's BRL at today's rate (5 EUR = R$ 50), then to US$ 10.
    const atRate = await withdraw(pjEurBroker.id, 5, { counterpartAccountId: pfUsd.id });
    expect(await legs(atRate.transferGroupIds[0])).toEqual([
      [pjEurBroker.id, "EUR", -5],
      [f.pjChecking, "BRL", 50],
    ]);
    expect(await legs(atRate.transferGroupIds[1])).toEqual([
      [f.pjChecking, "BRL", -50],
      [pfUsd.id, "USD", 10],
    ]);
  });
});
