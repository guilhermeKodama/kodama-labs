import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-v2-scope-routes-001";
const OTHER = "test-user-v2-scope-routes-002";
const app = createApp();
let f: LedgerFixture;
let other: LedgerFixture;
let cookie: string;

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method: string, path: string, body?: unknown) => {
  const res = await call(method, path, body);
  expect(res.status).toBe(200);
  return res.json();
};

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;

  // PF holds crypto at XP, PJ holds a Brazilian stock at its own broker; both bought in September with money from checking.
  const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } });
  const btc = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currentPrice: 100 });
  const wege = await json("POST", "/v2/holdings", { accountId: pjBroker.id, assetClass: "stocks", ticker: "WEGE3", name: "WEG", currentPrice: 100 });
  await json("POST", "/v2/investment-operations", { holdingId: btc.id, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, date: "2026-09-05", fundFromAccountId: f.pfChecking });
  await json("POST", "/v2/investment-operations", { holdingId: wege.id, type: "buy", quantity: 5, pricePerUnit: 100, totalAmount: 500, date: "2026-09-06", fundFromAccountId: f.pjChecking });
  await json("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "br_stocks", targetPercent: 50 }, { allocationClass: "crypto", targetPercent: 50 }] });

  // Groceries budgeted for every entity, Software only for the PJ (monthly and yearly).
  await json("POST", "/v2/budgets", { categoryId: f.categories.Groceries, amount: 1000, effectiveFrom: "2026-09" });
  await json("POST", "/v2/budgets", { entityId: f.pjId, categoryId: f.categories.Software, amount: 300, effectiveFrom: "2026-09" });
  await json("POST", "/v2/budgets", { entityId: f.pjId, categoryId: f.categories.Software, amount: 2000, period: "yearly", effectiveFrom: "2026-01" });
  for (const [accountId, categoryId, amount] of [
    [f.pfChecking, f.categories.Groceries, 100],
    [f.pjChecking, f.categories.Groceries, 50],
    [f.pjChecking, f.categories.Software, 70],
  ] as const) {
    await json("POST", "/v2/ledger/entries", { kind: "expense", accountId, categoryId, amount, date: "2026-09-12", description: "Compra" });
  }
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("?scope= on the portfolio routes", () => {
  it("scopes the summary to pf, pj, one entity or all, and 404s on someone else's entity", async () => {
    const value = async (q: string) => (await json("GET", `/v2/portfolio/summary${q}`)).marketValue;
    expect(await value("")).toBe(1500);
    expect(await value("?scope=all")).toBe(1500);
    expect(await value("?scope=pf")).toBe(1000);
    expect(await value("?scope=pj")).toBe(500);
    expect(await value(`?scope=${f.pjId}`)).toBe(500);
    expect(await value(`?entityId=${f.pfId}`)).toBe(1000);
    const foreign = await call("GET", `/v2/portfolio/summary?scope=${other.pjId}`);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "entity.not_found" });
  });

  it("scopes holdings and contributions", async () => {
    expect((await json("GET", "/v2/holdings?scope=pj")).holdings.map((h: { ticker: string }) => h.ticker)).toEqual(["WEGE3"]);
    const september = async (scope: string) => (await json("GET", `/v2/contributions?year=2026&scope=${scope}`)).months[8].deposits;
    expect(await september("pf")).toBe(1000);
    expect(await september("pj")).toBe(500);
    expect(await september("all")).toBe(1500);
  });

  it("splits a new contribution against the scope's own allocation", async () => {
    const brStocks = async (scope?: string) =>
      (await json("POST", "/v2/portfolio/rebalance-suggestion", { amount: 1000, ...(scope && { scope }) })).classes.find((c: { allocationClass: string }) => c.allocationClass === "br_stocks");
    expect(await brStocks("pj")).toMatchObject({ currentShare: 1, amount: 250 });
    expect(await brStocks()).toMatchObject({ currentShare: 0.3333, amount: 750 });
  });
});

describe("?scope= on the budget overview", () => {
  it("keeps the budgets and spend of the scope's entities, budgets for every entity included", async () => {
    const month = async (scope: string) => json("GET", `/v2/budgets/overview?month=2026-09&scope=${scope}`);
    const pf = await month("pf");
    expect(pf.budgets.map((b: { categoryId: string; spent: number }) => [b.categoryId, b.spent])).toEqual([[f.categories.Groceries, 100]]);
    expect(pf.yearlyBudgets).toEqual([]);

    const pj = await month("pj");
    expect(Object.fromEntries(pj.budgets.map((b: { categoryId: string; spent: number }) => [b.categoryId, b.spent]))).toEqual({
      [f.categories.Groceries]: 50,
      [f.categories.Software]: 70,
    });
    expect(pj.yearlyBudgets).toEqual([expect.objectContaining({ categoryId: f.categories.Software, amount: 2000, spent: 70 })]);

    const all = await month("all");
    expect(all.budgets.find((b: { categoryId: string }) => b.categoryId === f.categories.Groceries).spent).toBe(150);
  });

  it("sums only the scope's monthly budgets in the year view", async () => {
    expect((await json("GET", "/v2/budgets/overview?year=2026&scope=pf")).monthBudgets[8]).toBe(1000);
    expect((await json("GET", "/v2/budgets/overview?year=2026&scope=pj")).monthBudgets[8]).toBe(1300);
  });
});
