import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { recordAporte } from "../aporte";
import { contributions } from "../contributions";
import { createHolding, recordOperation } from "../portfolio";

const USER = "test-user-investments-contributions-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const transfer = (fromAccountId: string, toAccountId: string, amount: number, date: string, description?: string) =>
  createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date, description }, prisma);

/**
 * Nov/25: salary 10k, aporte 3k. Dec/25: profit distribution 5k into PF,
 * aporte 4k, PETR4 bought for 2,010 (fees included), groceries 300.
 * Jan/26: resgate 500, aporte of 2k straight from the PJ account (a profit
 * distribution PJ → PF plus the deposit, in one batch).
 */
async function seed() {
  await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10000, date: "2025-11-05", description: "Salário", categoryId: f.categories.Salary }, prisma);
  await transfer(f.pfChecking, f.broker, 3000, "2025-11-10", "Aporte novembro");
  await transfer(f.pjChecking, f.pfChecking, 5000, "2025-12-05", "Distribuição de lucros");
  await transfer(f.pfChecking, f.broker, 4000, "2025-12-10");
  await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2025-12-11", description: "Mercado", categoryId: f.categories.Groceries }, prisma);
  const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
  await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 50, pricePerUnit: 40, totalAmount: 2000, fees: 10, date: "2025-12-12" }, prisma);
  await transfer(f.broker, f.pfChecking, 500, "2026-01-10");
  return recordAporte(USER, { fromAccountId: f.pjChecking, brokerAccountId: f.broker, amount: 2000, date: "2026-01-15" }, prisma);
}

describe("contributions", () => {
  it("covers a trailing window across the year boundary, with buys by class, origins and the PF savings rate", async () => {
    const aporte = await seed();
    const c = await contributions(USER, prisma, { months: 3, end: "2026-01" });
    expect(c).toMatchObject({ from: "2025-11", to: "2026-01", totalNet: 8500 });
    expect(c).not.toHaveProperty("year");
    expect(c.averageMonthly).toBeCloseTo(8500 / 3, 2);
    expect(c.months.map((m) => [m.period, m.year, m.month, m.deposits, m.withdrawals, m.net])).toEqual([
      ["2025-11", 2025, 11, 3000, 0, 3000],
      ["2025-12", 2025, 12, 4000, 0, 4000],
      ["2026-01", 2026, 1, 2000, 500, 1500],
    ]);
    // Nov: nothing bought, all of it stayed as cash. Dec: 2,010 into BR stocks, the rest is cash.
    expect(c.months[0].byAllocationClass).toEqual({ cash: 3000 });
    expect(c.months[1].byAllocationClass).toEqual({ br_stocks: 2010, cash: 1990 });
    expect(c.months[1].byAssetClass).toEqual({ stocks: 2010 });

    expect(c.months[0].origins).toEqual([
      expect.objectContaining({ amount: 3000, direction: "investment_deposit", description: "Aporte novembro", brokerAccountName: "XP", counterpartAccountName: "Conta principal", counterpartEntityName: "PF", sourceEntityName: null }),
    ]);
    // January, newest first: the cross-entity aporte names the PJ as the source, the resgate is negative.
    const [jan15, jan10] = c.months[2].origins;
    expect(jan15).toMatchObject({ date: "2026-01-15", amount: 2000, counterpartEntityName: "PF", sourceEntityName: "Kodama LTDA" });
    expect(aporte.transferGroupIds).toContain(jan15.transferGroupId);
    expect(aporte.transferGroupIds).toContain(jan15.sourceTransferGroupId);
    expect(jan10).toMatchObject({ date: "2026-01-10", amount: -500, direction: "investment_withdrawal", sourceEntityName: null });

    // PF aportes 8.5k over PF Entradas: salary 10k + the two profit distributions (5k and 2k). Groceries,
    // the aportes themselves and the buy's cash leg are not income.
    expect(c.savingsRate).toEqual({ aportes: 8500, income: 17000, rate: 0.5 });
  });

  it("keeps the calendar-year mode and filters by scope (the savings rate stays PF)", async () => {
    await seed();
    const y = await contributions(USER, prisma, { year: 2025 });
    expect(y).toMatchObject({ year: 2025, from: "2025-01", to: "2025-12", totalNet: 7000 });
    expect(y.months).toHaveLength(12);
    expect(y.months[10]).toMatchObject({ month: 11, net: 3000 });
    expect(y.months[0]).toMatchObject({ month: 1, net: 0, byAllocationClass: {}, origins: [] });

    const pj = await contributions(USER, prisma, { months: 3, end: "2026-01", entityIds: [f.pjId] });
    expect(pj.months.map((m) => m.net)).toEqual([0, 0, 0]);
    expect(pj.savingsRate.rate).toBe(0.5);
  });

  it("has no savings rate without PF income", async () => {
    await transfer(f.pfChecking, f.broker, 1000, "2026-03-02");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-03" });
    expect(c.savingsRate).toEqual({ aportes: 1000, income: 0, rate: null });
  });
});
