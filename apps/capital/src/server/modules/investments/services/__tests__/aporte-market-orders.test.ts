import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote } from "../../lib/quotes";

const quotes = vi.hoisted(() => ({ fetchQuotes: vi.fn(), searchAssets: vi.fn() }));
vi.mock("../../lib/quotes", () => ({ fetchQuotes: quotes.fetchQuotes, searchAssets: quotes.searchAssets }));

import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { recordAporte } from "../aporte";
import { quotesFor, searchAssetsFor } from "../market";
import { recordOrders } from "../orders";
import { createHolding } from "../portfolio";

const USER = "test-user-inv-aportemarket-001";
let f: LedgerFixture;

beforeEach(async () => {
  // 1 USD = 5 BRL.
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  quotes.fetchQuotes.mockReset();
  quotes.fetchQuotes.mockResolvedValue({});
  quotes.searchAssets.mockReset();
  quotes.searchAssets.mockResolvedValue([]);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const legs = async (transferGroupId: string) => {
  const rows = await prisma.ledgerEntry.findMany({ where: { transferGroupId }, orderBy: { amount: "asc" } });
  return rows.map((r) => [r.accountId, r.currency, toNumber(r.amount)]);
};

describe("recordAporte", () => {
  it("credits a foreign-currency broker with the amount received, or with today's conversion when none is given", async () => {
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const given = await recordAporte(USER, { fromAccountId: f.pfChecking, brokerAccountId: usd.id, amount: 500, toAmount: 98, date: "2026-09-10" }, prisma);
    expect(await legs(given.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -500],
      [usd.id, "USD", 98],
    ]);
    const converted = await recordAporte(USER, { fromAccountId: f.pfChecking, brokerAccountId: usd.id, amount: 500, date: "2026-09-11" }, prisma);
    expect(await legs(converted.transferGroupIds[0])).toEqual([
      [f.pfChecking, "BRL", -500],
      [usd.id, "USD", 100],
    ]);
  });

  it("buys a new asset at a price of zero without pricing it, and answers no operation fields without a buy", async () => {
    const plain = await recordAporte(USER, { fromAccountId: f.pfChecking, brokerAccountId: f.broker, amount: 100, date: "2026-09-10" }, prisma);
    expect(plain).not.toHaveProperty("operationId");
    expect(plain).not.toHaveProperty("holdingId");

    const bought = await recordAporte(
      USER,
      { fromAccountId: f.pfChecking, brokerAccountId: f.broker, amount: 100, date: "2026-09-11", buy: { newHolding: { ticker: "xyz3", name: "Sem preço", assetClass: "stocks" }, quantity: 3, price: 0 } },
      prisma,
    );
    const holding = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: bought.holdingId! } });
    expect(holding).toMatchObject({ ticker: "XYZ3", currentPrice: null, accountId: f.broker });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: bought.operationId! } })).toMatchObject({ quantity: 3, pricePerUnit: 0, totalAmount: 0 });
  });

  it("refuses a buy that names neither a holding nor a new one, and writes nothing", async () => {
    await expect(
      recordAporte(USER, { fromAccountId: f.pfChecking, brokerAccountId: f.broker, amount: 100, date: "2026-09-10", buy: { quantity: 1, price: 10 } }, prisma),
    ).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(0);
  });

  it("refuses a buy of an asset held at another broker", async () => {
    const other = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Rico", currency: "BRL" } });
    const held = await createHolding(USER, { accountId: other.id, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    await expect(
      recordAporte(USER, { fromAccountId: f.pfChecking, brokerAccountId: f.broker, amount: 100, date: "2026-09-10", buy: { holdingId: held.id, quantity: 1, price: 10 } }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "aporte.holding_mismatch" });
  });
});

describe("recordOrders", () => {
  it("books a buy with no amount, quantity or price as a zero buy that moves no cash", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    const result = await recordOrders(USER, { date: "2026-09-10", orders: [{ holdingId: h.id }] }, prisma);
    expect(result.operations).toEqual([{ operationId: expect.any(String), holdingId: h.id, cashEntryId: null, fundingGroupId: null }]);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operations[0].operationId } })).toMatchObject({ quantity: null, pricePerUnit: null, totalAmount: 0 });
  });

  it("prices by quantity times price, or by the amount for assets tracked by amount, and names the batch after every asset", async () => {
    const cdb = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "CDB Banco X" }, prisma);
    const result = await recordOrders(
      USER,
      {
        date: "2026-09-10",
        fundFromAccountId: f.pfChecking,
        orders: [
          { newHolding: { accountId: f.broker, ticker: "bova11", name: "iShares", assetClass: "etf" }, quantity: 5, price: 100.5, fees: 2 },
          { holdingId: cdb.id, amount: 1500 },
        ],
      },
      prisma,
    );
    const ops = await prisma.investmentOperation.findMany({ where: { id: { in: result.operations.map((o) => o.operationId) } } });
    expect(Object.fromEntries(ops.map((o) => [o.holdingId, o.totalAmount]))).toEqual({ [result.operations[0].holdingId]: 502.5, [cdb.id]: 1500 });
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: result.batchId } })).summary).toBe("Compra BOVA11, CDB Banco X");
    const created = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: result.operations[0].holdingId } });
    // A new asset bought by quantity starts at the buy price.
    expect(created).toMatchObject({ ticker: "BOVA11", currentPrice: 100.5 });

    await undoBatch(USER, result.batchId, prisma);
    expect(await prisma.investmentHolding.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.investmentOperation.count({ where: { holdingId: cdb.id } })).toBe(0);
  });

  it("starts a new asset bought by amount without a price", async () => {
    const result = await recordOrders(USER, { date: "2026-09-10", orders: [{ newHolding: { accountId: f.broker, name: "Tesouro Selic", assetClass: "fixed_income" }, amount: 800 }] }, prisma);
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: result.operations[0].holdingId } })).toMatchObject({ currentPrice: null, name: "Tesouro Selic" });
  });
});

describe("quotesFor", () => {
  const quote = (ticker: string, source: Quote["source"] = "brapi"): Quote => ({ ticker, price: 10, currency: "BRL", source, asOf: null });

  it("prices a held ticker as its holding is priced and any other by its shape in the base currency, reporting what has no quote", async () => {
    await createHolding(USER, { accountId: f.broker, assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currency: "USD" }, prisma);
    quotes.fetchQuotes.mockResolvedValue({ BTC: quote("BTC", "coingecko"), PETR4: quote("PETR4") });
    const result = await quotesFor(USER, [" btc ", "petr4", "PETR4", "nope3", " "], prisma);
    expect(quotes.fetchQuotes).toHaveBeenCalledWith(
      [
        { ticker: "BTC", assetClass: "crypto", currency: "USD" },
        { ticker: "PETR4", assetClass: null, currency: "BRL" },
        { ticker: "NOPE3", assetClass: null, currency: "BRL" },
      ],
      expect.objectContaining({ cryptoCurrency: "BRL" }),
    );
    expect(result.quotes.map((q) => q.ticker)).toEqual(["BTC", "PETR4"]);
    expect(result.missing).toEqual(["NOPE3"]);
  });

  it("uses the active holding when the same ticker is held twice", async () => {
    const other = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Rico", currency: "USD" } });
    const stale = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "ABCD3", name: "Antigo" }, prisma);
    await prisma.investmentHolding.update({ where: { id: stale.id }, data: { isActive: false } });
    await createHolding(USER, { accountId: other.id, assetClass: "international_stocks", ticker: "ABCD3", name: "Novo", currency: "USD" }, prisma);
    await quotesFor(USER, ["abcd3"], prisma);
    expect(quotes.fetchQuotes.mock.calls[0][0]).toEqual([{ ticker: "ABCD3", assetClass: "international_stocks", currency: "USD" }]);
  });

  it("falls back to BRL as the base currency for an unknown user", async () => {
    quotes.fetchQuotes.mockResolvedValue({ PETR4: quote("PETR4") });
    const result = await quotesFor("test-user-inv-aportemarket-nobody", ["PETR4"], prisma);
    expect(result.quotes).toHaveLength(1);
    expect(quotes.fetchQuotes).toHaveBeenCalledWith([{ ticker: "PETR4", assetClass: null, currency: "BRL" }], expect.objectContaining({ cryptoCurrency: "BRL" }));
  });
});

describe("searchAssetsFor", () => {
  it("lists a holding that was never priced without a price or a price date, and never asks the market when remote is off or the holdings fill the limit", async () => {
    const unpriced = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    const local = await searchAssetsFor(USER, "petr", prisma, { remote: false });
    expect(local.results).toEqual([
      expect.objectContaining({ ticker: "PETR4", source: "holding", holdingId: unpriced.id, accountName: "XP", price: null, priceAsOf: null, allocationClass: "br_stocks" }),
    ]);
    expect(await searchAssetsFor(USER, "petr", prisma, { limit: 1 })).toEqual({ results: local.results });
    expect(quotes.searchAssets).not.toHaveBeenCalled();
  });

  it("adds market results the user does not hold, in the user's base currency for crypto, keeping the limit", async () => {
    await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    quotes.searchAssets.mockResolvedValue([
      { ticker: "PETR4", name: "Petrobras PN", assetClass: "stocks", currency: "BRL", price: 40, source: "brapi" },
      { ticker: "PETZ3", name: "Petz", assetClass: "stocks", currency: "BRL", price: 12, source: "brapi" },
      { ticker: "VOO", name: "Vanguard", assetClass: "international_etf", currency: "USD", price: 500, source: "yahoo" },
    ]);
    const { results } = await searchAssetsFor(USER, "pe", prisma, { limit: 3 });
    expect(quotes.searchAssets).toHaveBeenCalledWith("pe", expect.objectContaining({ cryptoCurrency: "BRL", limit: 3 }));
    expect(results.map((r) => [r.ticker, r.source, r.allocationClass, r.holdingId === null])).toEqual([
      ["PETR4", "holding", "br_stocks", false],
      ["PETZ3", "brapi", "br_stocks", true],
      ["VOO", "yahoo", "international", true],
    ]);
    expect(results[1]).toMatchObject({ price: 12, priceAsOf: null, accountId: null, accountName: null });
  });
});
