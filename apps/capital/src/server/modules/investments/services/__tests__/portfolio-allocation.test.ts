import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, getTargets, portfolioSummary, rebalanceSuggestion, recordOperation, setTargets } from "../portfolio";

const USER = "test-user-inv-pfalloc-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const holding = (patch: Partial<Parameters<typeof createHolding>[1]> & Pick<Parameters<typeof createHolding>[1], "assetClass" | "name">) =>
  createHolding(USER, { accountId: f.broker, ...patch }, prisma);

describe("portfolioSummary price freshness", () => {
  it("lists a priceable holding that was never priced or whose price is stale, and leaves out the ones no source covers", async () => {
    const stale = await holding({ assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 });
    await prisma.investmentHolding.update({ where: { id: stale.id }, data: { currentQuantity: 10, totalInvested: 300, lastPriceUpdate: new Date("2026-01-05T20:00:00Z") } });
    await holding({ assetClass: "stocks", ticker: "VALE3", name: "Vale" });
    const fresh = await holding({ assetClass: "stocks", ticker: "WEGE3", name: "WEG", currentPrice: 50 });
    await prisma.investmentHolding.update({ where: { id: fresh.id }, data: { currentQuantity: 2, totalInvested: 90, lastPriceUpdate: new Date() } });
    await holding({ assetClass: "fixed_income", ticker: "CDB1", name: "CDB" });
    await holding({ assetClass: "stocks", name: "Sem ticker" });

    const summary = await portfolioSummary(USER, prisma);
    expect(summary.holdingsCount).toBe(5);
    expect(summary.staleHoldings.map((h) => [h.ticker, h.priceStatus, h.lastPriceUpdate]).sort()).toEqual([
      ["PETR4", "stale", "2026-01-05T20:00:00.000Z"],
      ["VALE3", "unpriced", null],
    ]);
    // The oldest price among the holdings a source covers: the stale PETR4, not the fresh WEGE3.
    expect(summary.pricesUpdatedAt).toBe("2026-01-05T20:00:00.000Z");
  });

  it("has no oldest price while nothing has been priced, and leaves a priced fixed income out of it", async () => {
    await holding({ assetClass: "stocks", ticker: "VALE3", name: "Vale" });
    const cdb = await holding({ assetClass: "fixed_income", ticker: "CDB1", name: "CDB" });
    await prisma.investmentHolding.update({ where: { id: cdb.id }, data: { lastPriceUpdate: new Date("2026-01-05T20:00:00Z") } });
    expect((await portfolioSummary(USER, prisma)).pricesUpdatedAt).toBeNull();
  });

  it("converts each holding and each broker's cash at today's rate and counts the brokers", async () => {
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const voo = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VOO", name: "Vanguard", currentPrice: 500 }, prisma);
    await recordOperation(USER, { holdingId: voo.id, type: "buy", quantity: 2, pricePerUnit: 400, totalAmount: 800, date: "2026-09-01" }, prisma);
    await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: ibkr.id,
        kind: "income",
        amount: 100,
        currency: "USD",
        exchangeRate: 5,
        amountBase: 500,
        date: new Date("2026-09-05T12:00:00Z"),
        effectiveDate: new Date("2026-09-05T12:00:00Z"),
        description: "Cash",
      },
    });

    const summary = await portfolioSummary(USER, prisma);
    expect(summary).toMatchObject({ baseCurrency: "BRL", marketValue: 5000, invested: 4000, unrealizedGain: 1000, accountsCount: 2 });
    const broker = summary.brokers.find((b) => b.accountId === ibkr.id);
    // The buy drew 800 down from the broker's cash, the deposit added 100.
    expect(broker).toMatchObject({ currency: "USD", cash: -700, cashBase: -3500 });
    expect(summary.brokers.find((b) => b.accountId === f.broker)).toMatchObject({ cash: 0, cashBase: 0 });
  });

  it("lists an allocation class that only has a target, and shares as zero while the portfolio is empty", async () => {
    await setTargets(USER, [{ allocationClass: "crypto", targetPercent: 100 }], prisma);
    const summary = await portfolioSummary(USER, prisma);
    expect(summary.netWorth).toBe(0);
    expect(summary.allocation).toEqual([{ allocationClass: "crypto", marketValue: 0, invested: 0, count: 0, share: 0, target: 1 }]);
    expect(summary.resultPercent).toBeNull();
  });
});

describe("setTargets and getTargets", () => {
  it("accepts percents or fractions, storing fractions in display order", async () => {
    const percents = await setTargets(USER, [{ allocationClass: "cash", targetPercent: 40 }, { allocationClass: "fii", targetPercent: 60 }], prisma);
    expect(percents.map((t) => [t.allocationClass, t.targetPercent])).toEqual([
      ["fii", 0.6],
      ["cash", 0.4],
    ]);

    const fractions = await setTargets(USER, [{ allocationClass: "crypto", targetPercent: 0.25 }, { allocationClass: "br_stocks", targetPercent: 0.75 }], prisma);
    expect(fractions.map((t) => [t.allocationClass, t.targetPercent])).toEqual([
      ["br_stocks", 0.75],
      ["crypto", 0.25],
    ]);
    expect((await getTargets(USER, prisma)).map((t) => t.allocationClass)).toEqual(["br_stocks", "crypto"]);
  });

  it("refuses targets that do not add up to 100%, keeping the ones stored", async () => {
    await setTargets(USER, [{ allocationClass: "fii", targetPercent: 100 }], prisma);
    await expect(setTargets(USER, [{ allocationClass: "fii", targetPercent: 60 }, { allocationClass: "cash", targetPercent: 30 }], prisma)).rejects.toMatchObject({
      status: 422,
      code: "portfolio.targets_sum",
    });
    expect((await getTargets(USER, prisma)).map((t) => t.allocationClass)).toEqual(["fii"]);
  });

  it("maps an asset-class target to its allocation class, and sends an etf target where most of the user's ETF money is", async () => {
    const mapped = await setTargets(USER, [{ assetClass: "stocks", targetPercent: 50 }, { assetClass: "bdr", targetPercent: 50 }], prisma);
    expect(mapped.map((t) => [t.allocationClass, t.targetPercent])).toEqual([
      ["br_stocks", 0.5],
      ["international", 0.5],
    ]);

    // Without ETF holdings an etf target is Brazilian.
    expect((await setTargets(USER, [{ assetClass: "etf", targetPercent: 100 }], prisma)).map((t) => t.allocationClass)).toEqual(["br_stocks"]);

    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const etf = await createHolding(USER, { accountId: ibkr.id, assetClass: "etf", ticker: "SPY", name: "SPDR", currency: "USD" }, prisma);
    await prisma.investmentHolding.update({ where: { id: etf.id }, data: { totalInvested: 1000 } });
    expect((await setTargets(USER, [{ assetClass: "etf", targetPercent: 100 }], prisma)).map((t) => t.allocationClass)).toEqual(["international"]);
  });
});

describe("rebalanceSuggestion refusals", () => {
  it("refuses an amount that is not positive, and a portfolio with no targets", async () => {
    await expect(rebalanceSuggestion(USER, 0, "class", prisma)).rejects.toMatchObject({ status: 422, code: "rebalance.invalid_amount" });
    await expect(rebalanceSuggestion(USER, -10, "class", prisma)).rejects.toMatchObject({ status: 422, code: "rebalance.invalid_amount" });
    await expect(rebalanceSuggestion(USER, Number.NaN, "asset", prisma)).rejects.toMatchObject({ code: "rebalance.invalid_amount" });
    await expect(rebalanceSuggestion(USER, 100, "class", prisma)).rejects.toMatchObject({ status: 422, code: "rebalance.no_targets" });
  });
});

describe("rebalanceSuggestion over an empty portfolio", () => {
  it("splits the new money by the targets, with zero current shares", async () => {
    await setTargets(USER, [{ allocationClass: "br_stocks", targetPercent: 70 }, { allocationClass: "crypto", targetPercent: 30 }], prisma);
    const byClass = await rebalanceSuggestion(USER, 1000, "class", prisma);
    expect(byClass.total).toBe(0);
    expect(byClass.classes).toEqual([
      { allocationClass: "br_stocks", value: 0, currentShare: 0, target: 0.7, amount: 700, afterShare: 0.7 },
      { allocationClass: "crypto", value: 0, currentShare: 0, target: 0.3, amount: 300, afterShare: 0.3 },
    ]);

    const byAsset = await rebalanceSuggestion(USER, 1000, "asset", prisma);
    expect(byAsset.assets).toEqual([
      expect.objectContaining({ kind: "new", allocationClass: "br_stocks", amount: 700, currency: "BRL", holdingId: null, approxQuantity: null }),
      expect.objectContaining({ kind: "new", allocationClass: "crypto", amount: 300 }),
    ]);
  });

  it("splits a class's money equally between holdings that are worth nothing yet, and sizes the units by the price", async () => {
    await setTargets(USER, [{ allocationClass: "br_stocks", targetPercent: 100 }], prisma);
    const priced = await holding({ assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 });
    const unpriced = await holding({ assetClass: "stocks", ticker: "VALE3", name: "Vale" });
    const suggestion = await rebalanceSuggestion(USER, 1000, "asset", prisma);
    expect(suggestion.assets).toHaveLength(2);
    const byTicker = Object.fromEntries(suggestion.assets!.map((a) => [a.ticker, a]));
    expect(byTicker.PETR4).toMatchObject({ kind: "holding", holdingId: priced.id, amount: 500, price: 40, approxQuantity: 12.5 });
    expect(byTicker.VALE3).toMatchObject({ kind: "holding", holdingId: unpriced.id, amount: 500, price: null, approxQuantity: null });
  });

  it("weights a class's holdings by their value and converts a foreign one to the base currency", async () => {
    await setTargets(USER, [{ allocationClass: "international", targetPercent: 100 }], prisma);
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const voo = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VOO", name: "Vanguard", currentPrice: 100 }, prisma);
    await recordOperation(USER, { holdingId: voo.id, type: "buy", quantity: 3, pricePerUnit: 100, totalAmount: 300, date: "2026-09-01" }, prisma);
    const aapl = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_stocks", ticker: "AAPL", name: "Apple", currentPrice: 100 }, prisma);
    await recordOperation(USER, { holdingId: aapl.id, type: "buy", quantity: 1, pricePerUnit: 100, totalAmount: 100, date: "2026-09-01" }, prisma);

    const suggestion = await rebalanceSuggestion(USER, 1000, "asset", prisma);
    // US$ 300 against US$ 100: three quarters to VOO, in the order of the holdings (stocks before ETFs). The amounts are in R$ (1 USD = 5 BRL) and the quantity at US$ 100 a unit.
    expect(suggestion.assets!.map((a) => [a.ticker, a.amount, a.currency, a.approxQuantity])).toEqual([
      ["AAPL", 250, "USD", 0.5],
      ["VOO", 750, "USD", 1.5],
    ]);
    expect(suggestion.assets!.reduce((sum, a) => sum + a.amount, 0)).toBe(1000);
  });
});
