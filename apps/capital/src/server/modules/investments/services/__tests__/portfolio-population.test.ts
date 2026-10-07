import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding, portfolioSummary, recordOperation, updateHolding } from "../portfolio";
import { portfolioHistory } from "../portfolio-history";

/**
 * "Patrimônio", "Total aportado" and "Resultado" are computed over the same
 * population: an archived broker and a deactivated holding count on
 * neither side (they used to count in "Total aportado" only, which turned
 * Resultado deeply negative). A holding registered without operations is a
 * "posição inicial", reported apart from the aportes.
 */
const USER = "test-user-investments-population-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

/** A date `monthsAgo` months before the current one (UTC), on `day`, as YYYY-MM-DD. */
function ago(monthsAgo: number, day: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, 12)).toISOString().slice(0, 10);
}
const transfer = (fromAccountId: string, toAccountId: string, amount: number, date: string) =>
  createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date, direction: "investment_deposit" }, prisma);

/** A holding typed in without any operation (MCP, legacy import): quantity and cost only. */
const registered = (data: { ticker: string; quantity: number; averageCost: number; price: number; createdAt: string; isActive?: boolean }) =>
  prisma.investmentHolding.create({
    data: {
      accountId: f.broker,
      assetClass: "stocks",
      ticker: data.ticker,
      name: data.ticker,
      currentQuantity: data.quantity,
      averageCost: data.averageCost,
      totalInvested: data.quantity * data.averageCost,
      currentPrice: data.price,
      isActive: data.isActive ?? true,
      createdAt: new Date(`${data.createdAt}T12:00:00Z`),
    },
  });

describe("portfolio population", () => {
  it("leaves archived brokers and deactivated holdings out of both Patrimônio and Total aportado", async () => {
    // Live: 10k in, 100 PETR4 at 30 (now 40) paid from the broker's cash.
    await transfer(f.pfChecking, f.broker, 10000, ago(3, 10));
    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 100, pricePerUnit: 30, totalAmount: 3000, date: ago(3, 15) }, prisma);

    // An archived broker that still has 5k of cash.
    const old = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Antiga", currency: "BRL" } });
    await transfer(f.pfChecking, old.id, 5000, ago(3, 12));
    await prisma.account.update({ where: { id: old.id }, data: { archivedAt: new Date() } });

    // A deactivated holding registered without operations (2k of cost), and one with operations, deactivated after selling nothing.
    await registered({ ticker: "OIBR3", quantity: 1000, averageCost: 2, price: 1, createdAt: ago(2, 3), isActive: false });
    const vale = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale", currentPrice: 60 }, prisma);
    await recordOperation(USER, { holdingId: vale.id, type: "buy", quantity: 10, pricePerUnit: 50, totalAmount: 500, date: ago(2, 5) }, prisma);
    await updateHolding(USER, vale.id, { isActive: false }, prisma);

    // An active holding registered without operations: a "posição inicial" of 2k (now worth 2.5k).
    await registered({ ticker: "ITUB4", quantity: 100, averageCost: 20, price: 25, createdAt: ago(1, 20) });

    const summary = await portfolioSummary(USER, prisma);
    // 100 PETR4 x 40 + 100 ITUB4 x 25 + 6.5k of cash (10k − 3k − 500).
    expect(summary.netWorth).toBe(13000);
    // 10k of aportes + 2k of posições iniciais; nothing from the archived broker or the deactivated holdings.
    expect(summary.contributed).toBe(12000);
    expect(summary.initialPositions).toBe(2000);
    // 1k on PETR4 + 500 on ITUB4 − the 500 that went into VALE3, which is no longer counted.
    expect(summary.result).toBe(1000);
    expect(summary.accountsCount).toBe(1);

    const history = await portfolioHistory(USER, prisma, { months: 4 });
    const live = history.months.at(-1)!;
    expect([live.netWorth, live.contributed, live.initialPositions]).toEqual([13000, 12000, 2000]);
    // The posição inicial enters in the month it was typed, as such, not as an aporte.
    const byPeriod = new Map(history.months.map((m) => [m.period, m]));
    expect(byPeriod.get(ago(2, 1).slice(0, 7))).toMatchObject({ contributed: 10000, initialPositions: 0 });
    expect(byPeriod.get(ago(1, 1).slice(0, 7))).toMatchObject({ contributed: 12000, initialPositions: 2000 });
  });
});
