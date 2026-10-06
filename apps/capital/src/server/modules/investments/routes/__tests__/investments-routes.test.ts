import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(async (ticker: string) => (ticker === "VOO" ? { regularMarketPrice: 500.5, currency: "USD", regularMarketTime: new Date("2026-10-05T17:32:00Z") } : undefined)),
  search: vi.fn(async () => ({ quotes: [] })),
}));
vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = yahoo.quote;
    search = yahoo.search;
  },
}));

import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-investments-routes-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;
let pjBroker: string;

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method: string, path: string, body?: unknown) => {
  const res = await call(method, path, body);
  const data = await res.json();
  expect(res.status, JSON.stringify(data)).toBe(200);
  return data;
};
const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId) ?? 0;
const undo = (batchId: string) => json("POST", `/v2/mutations/${batchId}/undo`, {});

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(async () => {
  // Every test starts from the fixture's empty ledger and the same PJ broker.
  await prisma.investmentHolding.deleteMany({ where: { account: { userId: USER } } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
  await prisma.transferGroup.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER, name: { in: ["BTG"] } } });
  pjBroker = (await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } })).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("POST /v2/investments/aporte", () => {
  it("books a same-entity aporte as one investment deposit, buying a new asset with it, and undo removes it all", async () => {
    const r = await json("POST", "/v2/investments/aporte", {
      fromAccountId: f.pfChecking,
      brokerAccountId: f.broker,
      amount: 1000,
      date: "2026-09-10",
      buy: { newHolding: { ticker: "bova11", name: "iShares Ibovespa", assetClass: "etf" }, quantity: 5, price: 128.4, fees: 1 },
    });
    expect(r.batchId).toBeTruthy();
    expect(r.transferGroupIds).toHaveLength(1);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.transferGroupIds[0] } });
    expect(group.direction).toBe("investment_deposit");
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: r.operationId } });
    expect(op).toMatchObject({ type: "buy", quantity: 5, pricePerUnit: 128.4, totalAmount: 642, fees: 1, fundingGroupId: group.id, holdingId: r.holdingId });
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: r.holdingId } })).toMatchObject({ ticker: "BOVA11", accountId: f.broker, totalInvested: 643 });
    expect(await balance(f.pfChecking)).toBe(-1000);
    expect(await balance(f.broker)).toBeCloseTo(357, 4);

    await undo(r.batchId);
    expect(await prisma.transferGroup.count({ where: { id: group.id } })).toBe(0);
    expect(await prisma.investmentOperation.count({ where: { id: r.operationId } })).toBe(0);
    expect(await prisma.investmentHolding.count({ where: { id: r.holdingId } })).toBe(0);
    expect(await balance(f.pfChecking)).toBe(0);
    expect(await balance(f.broker)).toBe(0);
  });

  it("books a cross-entity aporte as a capital injection or profit distribution plus the deposit, in one batch", async () => {
    const injection = await json("POST", "/v2/investments/aporte", { fromAccountId: f.pfChecking, brokerAccountId: pjBroker, amount: 2000, date: "2026-09-11", description: "Aporte BTG" });
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: injection.transferGroupIds } } });
    const byId = new Map(groups.map((g) => [g.id, g]));
    expect(injection.transferGroupIds.map((id: string) => byId.get(id)!.direction)).toEqual(["capital_injection", "investment_deposit"]);
    expect(byId.get(injection.transferGroupIds[1])!.description).toBe("Aporte BTG");
    expect(await balance(f.pfChecking)).toBe(-2000);
    expect(await balance(f.pjChecking)).toBe(0);
    expect(await balance(pjBroker)).toBe(2000);

    const holding = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itaú" });
    const distribution = await json("POST", "/v2/investments/aporte", {
      fromAccountId: f.pjChecking,
      brokerAccountId: f.broker,
      amount: 500,
      date: "2026-09-12",
      buy: { holdingId: holding.id, quantity: 10, price: 36.9 },
    });
    const directions = await prisma.transferGroup.findMany({ where: { id: { in: distribution.transferGroupIds } }, select: { id: true, direction: true } });
    expect(distribution.transferGroupIds.map((id: string) => directions.find((d) => d.id === id)!.direction)).toEqual(["profit_distribution", "investment_deposit"]);
    // The distribution lands on the PF checking and goes on to the PF broker.
    expect(await balance(f.pjChecking)).toBe(-500);
    expect(await balance(f.pfChecking)).toBe(-2000);
    expect(await balance(f.broker)).toBeCloseTo(131, 4);

    await undo(distribution.batchId);
    expect(await prisma.transferGroup.count({ where: { id: { in: distribution.transferGroupIds } } })).toBe(0);
    expect(await prisma.investmentOperation.count({ where: { id: distribution.operationId } })).toBe(0);
    // The holding existed before the aporte, so it stays.
    expect(await prisma.investmentHolding.count({ where: { id: holding.id } })).toBe(1);
    expect(await balance(f.pjChecking)).toBe(0);
    expect(await balance(f.broker)).toBe(0);
  });

  it("refuses non-broker destinations, card sources and assets at another broker", async () => {
    const bad = async (body: Record<string, unknown>, code: string) => {
      const res = await call("POST", "/v2/investments/aporte", { amount: 100, date: "2026-09-10", ...body });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code });
    };
    await bad({ fromAccountId: f.pfChecking, brokerAccountId: f.pjChecking }, "aporte.broker_required");
    await bad({ fromAccountId: f.card, brokerAccountId: f.broker }, "aporte.source_invalid");
    const holding = await json("POST", "/v2/holdings", { accountId: pjBroker, assetClass: "stocks", ticker: "WEGE3", name: "WEG" });
    await bad({ fromAccountId: f.pfChecking, brokerAccountId: f.broker, buy: { holdingId: holding.id, quantity: 1, price: 50 } }, "aporte.holding_mismatch");
    await bad({ fromAccountId: f.pfChecking, brokerAccountId: f.broker, buy: { quantity: 1, price: 50 } }, "validation");
    // A buy paid from a card is refused the same way.
    const fromCard = await call("POST", "/v2/investment-operations", { holdingId: holding.id, type: "buy", quantity: 1, pricePerUnit: 50, totalAmount: 50, date: "2026-09-10", fundFromAccountId: f.card });
    expect(fromCard.status).toBe(422);
    expect(await fromCard.json()).toMatchObject({ code: "aporte.source_invalid" });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(0);
  });

  it("ignores toAmount when the source and the broker share a currency", async () => {
    await json("POST", "/v2/investments/aporte", { fromAccountId: f.pfChecking, brokerAccountId: f.broker, amount: 300, toAmount: 999, date: "2026-09-10" });
    expect(await balance(f.pfChecking)).toBe(-300);
    expect(await balance(f.broker)).toBe(300);
  });
});

describe("POST /v2/investments/orders", () => {
  it("records every buy with its funding in one batch, and undo removes them all", async () => {
    const itub = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itaú", currentPrice: 36.9 });
    const r = await json("POST", "/v2/investments/orders", {
      date: "2026-09-15",
      fundFromAccountId: f.pfChecking,
      orders: [
        { holdingId: itub.id, quantity: 10, price: 36.9 },
        { newHolding: { accountId: pjBroker, ticker: "HGLG11", name: "CSHG Logística", assetClass: "fii" }, quantity: 2, price: 158.2 },
        { newHolding: { accountId: f.broker, name: "CDB Inter 110% CDI", assetClass: "fixed_income" }, amount: 1000 },
      ],
    });
    expect(r.operations).toHaveLength(3);
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId }, include: { records: true } });
    expect(batch.summary).toBe("Compra ITUB4, HGLG11, CDB Inter 110% CDI");
    expect(r.operations.every((o: { fundingGroupId: string | null }) => o.fundingGroupId)).toBe(true);
    expect(await balance(f.pfChecking)).toBeCloseTo(-(369 + 316.4 + 1000), 4);
    expect(await balance(f.broker)).toBeCloseTo(0, 4);
    // The PJ broker's order is paid through a capital injection to the PJ checking.
    expect(await balance(f.pjChecking)).toBeCloseTo(0, 4);
    expect(await balance(pjBroker)).toBeCloseTo(0, 4);
    const hglgFunding = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.operations[1].fundingGroupId } });
    expect(hglgFunding.direction).toBe("investment_deposit");
    expect(await prisma.transferGroup.count({ where: { userId: USER, direction: "capital_injection" } })).toBe(1);
    const cdb = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: r.operations[2].holdingId } });
    expect(cdb).toMatchObject({ currentQuantity: 0, totalInvested: 1000 });

    await undo(r.batchId);
    expect(await prisma.investmentOperation.count({ where: { id: { in: r.operations.map((o: { operationId: string }) => o.operationId) } } })).toBe(0);
    expect(await prisma.investmentHolding.count({ where: { account: { userId: USER } } })).toBe(1);
    expect(await balance(f.pfChecking)).toBe(0);
  });

  it("is all or nothing", async () => {
    const itub = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itaú" });
    const res = await call("POST", "/v2/investments/orders", {
      date: "2026-09-15",
      orders: [
        { holdingId: itub.id, quantity: 10, price: 36.9 },
        { holdingId: "00000000-0000-0000-0000-000000000000", quantity: 1, price: 1 },
      ],
    });
    expect(res.status).toBe(404);
    expect(await prisma.investmentOperation.count({ where: { holdingId: itub.id } })).toBe(0);
  });
});

describe("investment operation routes", () => {
  it("answers an oversell with 422 holding.oversell, scopes and pages the list", async () => {
    const pf = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" });
    const pj = await json("POST", "/v2/holdings", { accountId: pjBroker, assetClass: "stocks", ticker: "WEGE3", name: "WEG" });
    const created = await json("POST", "/v2/investment-operations", { holdingId: pf.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-09-01" });
    expect(created.batchId).toBeTruthy();
    expect(created.operation).toMatchObject({ ticker: "PETR4", accountId: f.broker, entityId: f.pfId, currency: "BRL", cashAmount: -300 });
    await json("POST", "/v2/investment-operations", { holdingId: pf.id, type: "dividend", incomeType: "dividend", totalAmount: 5, date: "2026-09-20", creditToAccountId: f.pfChecking });
    await json("POST", "/v2/investment-operations", { holdingId: pj.id, type: "buy", quantity: 1, pricePerUnit: 50, totalAmount: 50, date: "2026-09-25" });

    const oversell = await call("POST", "/v2/investment-operations", { holdingId: pf.id, type: "sell", quantity: 11, pricePerUnit: 30, totalAmount: 330, date: "2026-09-02" });
    expect(oversell.status).toBe(422);
    expect(await oversell.json()).toMatchObject({ code: "holding.oversell" });

    const all = await json("GET", "/v2/investment-operations");
    expect(all.operations.map((o: { ticker: string }) => o.ticker)).toEqual(["WEGE3", "PETR4", "PETR4"]);
    expect(all.total).toBe(3);
    expect((await json("GET", "/v2/investment-operations?scope=pj")).operations.map((o: { ticker: string }) => o.ticker)).toEqual(["WEGE3"]);
    const income = await json("GET", "/v2/investment-operations?type=dividend,yield_payment");
    expect(income.operations).toEqual([expect.objectContaining({ type: "dividend", creditToAccountId: f.pfChecking })]);
    const page = await json("GET", "/v2/investment-operations?limit=2");
    expect(page).toMatchObject({ total: 3, nextOffset: 2 });
    expect((await json("GET", "/v2/investment-operations?limit=2&offset=2")).nextOffset).toBeNull();
    expect((await call("GET", "/v2/investment-operations?type=bogus")).status).toBe(422);

    const holdings = await json("GET", "/v2/holdings?scope=pf");
    expect(holdings.holdings).toEqual([expect.objectContaining({ ticker: "PETR4", marketValueBase: 300, investedBase: 300, fxRate: 1 })]);
  });

  it("records creating and editing a holding in undo batches", async () => {
    const created = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "vale3", name: "Vale" });
    expect(created).toMatchObject({ ticker: "VALE3", batchId: expect.any(String) });
    const patched = await json("PATCH", `/v2/holdings/${created.id}`, { name: "Vale ON", currentPrice: 61.5, isActive: false });
    expect(patched).toMatchObject({ name: "Vale ON", currentPrice: 61.5, isActive: false, batchId: expect.any(String) });

    await undo(patched.batchId);
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ name: "Vale", currentPrice: null, isActive: true });
    await undo(created.batchId);
    expect(await prisma.investmentHolding.count({ where: { id: created.id } })).toBe(0);
  });
});

describe("market data", () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.startsWith("https://brapi.dev/api/quote/list")
      ? { stocks: [{ stock: "PETR3", name: "PETROBRAS ON", close: 41.1, type: "stock" }, { stock: "PETR4", name: "PETROBRAS PN", close: 38.2, type: "stock" }] }
      : url.startsWith("https://brapi.dev/api/quote/")
        ? { results: [{ symbol: "PETR4", regularMarketPrice: 38.2, currency: "BRL", regularMarketTime: "2026-10-05T17:32:00.000Z" }] }
        : url.startsWith("https://api.coingecko.com/")
          ? { bitcoin: { brl: 342100, last_updated_at: 1791222720 } }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it("GET /v2/quotes prices B3, international and crypto tickers (crypto in the base currency)", async () => {
    const r = await json("GET", "/v2/quotes?tickers=PETR4,voo,BTC,NOPE3");
    expect(r.quotes.map((q: { ticker: string; price: number; currency: string; source: string }) => [q.ticker, q.price, q.currency, q.source])).toEqual([
      ["PETR4", 38.2, "BRL", "brapi"],
      ["VOO", 500.5, "USD", "yahoo"],
      ["BTC", 342100, "BRL", "coingecko"],
    ]);
    expect(r.missing).toEqual(["NOPE3"]);
    expect((await call("GET", `/v2/quotes?tickers=${Array.from({ length: 21 }, (_, i) => `T${i}`).join(",")}`)).status).toBe(422);
  });

  it("GET /v2/assets/search lists the user's holdings first, then market results it does not hold", async () => {
    const petr = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras PN", currentPrice: 38 });
    const r = await json("GET", "/v2/assets/search?q=petr");
    expect(r.results.map((x: { ticker: string; source: string; holdingId: string | null }) => [x.ticker, x.source, x.holdingId])).toEqual([
      ["PETR4", "holding", petr.id],
      ["PETR3", "brapi", null],
    ]);
    expect(r.results[1]).toMatchObject({ assetClass: "stocks", allocationClass: "br_stocks", currency: "BRL", price: 41.1 });
    fetchMock.mockClear();
    const local = await json("GET", "/v2/assets/search?q=petr&remote=false");
    expect(local.results).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST /v2/holdings/refresh-prices stores the fetched prices on the user's active holdings", async () => {
    const petr = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras PN", currentPrice: 30 });
    const r = await json("POST", "/v2/holdings/refresh-prices", {});
    expect(r).toMatchObject({ totalHoldings: 1, updated: 1, failed: 0 });
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: petr.id } })).currentPrice).toBe(38.2);
  });
});

describe("targets and broker cash", () => {
  afterAll(async () => {
    await prisma.portfolioTarget.deleteMany({ where: { userId: USER } });
  });

  it("refuses targets that do not add up to 100% and keeps the saved ones", async () => {
    await json("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "fixed_income", targetPercent: 60 }, { allocationClass: "br_stocks", targetPercent: 40 }] });
    const bad = await call("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "fixed_income", targetPercent: 60 }, { allocationClass: "br_stocks", targetPercent: 30 }] });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "portfolio.targets_sum" });
    const saved = await json("GET", "/v2/portfolio/targets");
    expect(saved.targets).toHaveLength(2);
  });

  it("deposits and withdraws broker cash undoably, refusing a withdrawal above the balance", async () => {
    const deposit = await json("POST", "/v2/brokerage-cash", { accountId: f.broker, direction: "deposit", amount: 100, date: "2026-09-01", counterpartAccountId: f.pfChecking });
    expect(deposit.batchId).toBeTruthy();
    expect(await balance(f.broker)).toBe(100);

    const over = await call("POST", "/v2/brokerage-cash", { accountId: f.broker, direction: "withdraw", amount: 100.01, date: "2026-09-02" });
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ code: "brokerage.insufficient_cash" });

    const withdraw = await json("POST", "/v2/brokerage-cash", { accountId: f.broker, direction: "withdraw", amount: 40, date: "2026-09-02", counterpartAccountId: f.pfChecking });
    expect(await balance(f.broker)).toBe(60);
    await undo(withdraw.batchId);
    expect(await balance(f.broker)).toBe(100);
    await undo(deposit.batchId);
    expect(await balance(f.broker)).toBe(0);
  });
});

describe("history and contributions", () => {
  it("GET /v2/portfolio/history and /v2/contributions follow the scope and the window", async () => {
    await json("POST", "/v2/brokerage-cash", { accountId: f.broker, direction: "deposit", amount: 1000, date: "2026-08-03", counterpartAccountId: f.pfChecking });
    await json("POST", "/v2/brokerage-cash", { accountId: pjBroker, direction: "deposit", amount: 400, date: "2026-09-03", counterpartAccountId: f.pjChecking });

    // A long window, so the fixed dates stay inside it.
    const all = await json("GET", "/v2/portfolio/history?months=120");
    expect(all.months).toHaveLength(120);
    const aug = all.months.find((m: { period: string }) => m.period === "2026-08");
    const sep = all.months.find((m: { period: string }) => m.period === "2026-09");
    expect(aug).toMatchObject({ netWorth: 1000, contributed: 1000, netFlow: 1000, estimated: false });
    expect(sep).toMatchObject({ netWorth: 1400, contributed: 1400, netFlow: 400 });
    expect(all.return).toHaveProperty("months");
    const pf = await json("GET", "/v2/portfolio/history?months=120&scope=pf");
    expect(pf.months.find((m: { period: string }) => m.period === "2026-09")).toMatchObject({ netWorth: 1000, netFlow: 0 });

    const c = await json("GET", "/v2/contributions?months=2&end=2026-09&scope=pj");
    expect(c).toMatchObject({ from: "2026-08", to: "2026-09", totalNet: 400 });
    expect(c.months.map((m: { net: number }) => m.net)).toEqual([0, 400]);
    expect(c.savingsRate).toMatchObject({ aportes: 1000 });

    const bad = await call("GET", "/v2/contributions?end=2026-13");
    expect(bad.status).toBe(422);
    expect((await call("GET", "/v2/portfolio/history?scope=nope")).status).toBe(404);
  });
});
