import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-inv-routes-more-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

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

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(async () => {
  await prisma.portfolioTarget.deleteMany({ where: { userId: USER } });
  await prisma.investmentHolding.deleteMany({ where: { account: { userId: USER } } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
  await prisma.transferGroup.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("GET /v2/investment-operations date filters", () => {
  it("keeps the operations of the days asked for, both ends included", async () => {
    const h = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" });
    for (const [date, price] of [["2026-09-01", 30], ["2026-09-10", 31], ["2026-09-20", 32]] as const) {
      await json("POST", "/v2/investment-operations", { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: price, totalAmount: price, date });
    }
    const dates = async (query: string) => (await json("GET", `/v2/investment-operations${query}`)).operations.map((o: { date: string }) => o.date);
    expect(await dates("?from=2026-09-10")).toEqual(["2026-09-20", "2026-09-10"]);
    expect(await dates("?to=2026-09-10")).toEqual(["2026-09-10", "2026-09-01"]);
    expect(await dates("?from=2026-09-05&to=2026-09-15")).toEqual(["2026-09-10"]);
    expect(await dates("?holdingId=" + h.id)).toHaveLength(3);
    expect(await dates(`?accountId=${f.pjChecking}`)).toEqual([]);
  });
});

describe("investment operation and holding routes", () => {
  it("edits an operation in an undo batch, and deletes one together with the transfer that paid for it", async () => {
    const h = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" });
    const buy = await json("POST", "/v2/investment-operations", {
      holdingId: h.id,
      type: "buy",
      quantity: 10,
      pricePerUnit: 30,
      totalAmount: 300,
      date: "2026-09-01",
      fundFromAccountId: f.pfChecking,
    });
    expect(buy.fundingGroupId).toBeTruthy();

    const patched = await json("PATCH", `/v2/investment-operations/${buy.operation.id}`, { totalAmount: 320, notes: "ajustada" });
    expect(patched).toMatchObject({ batchId: expect.any(String), operation: { id: buy.operation.id, totalAmount: 320, notes: "ajustada", cashAmount: -320 } });
    expect(await balance(f.broker)).toBeCloseTo(-20, 4);

    const bad = await call("PATCH", `/v2/investment-operations/${buy.operation.id}`, { type: "dividend", taxWithheld: 999, totalAmount: 10 });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "operation.tax_exceeds_amount" });
    expect((await call("PATCH", "/v2/investment-operations/no-such-op", { notes: "x" })).status).toBe(404);

    const removed = await json("DELETE", `/v2/investment-operations/${buy.operation.id}?withFunding=true`);
    expect(removed).toMatchObject({ deleted: buy.operation.id, batchId: expect.any(String) });
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
    expect(await balance(f.pfChecking)).toBe(0);
    expect((await call("DELETE", `/v2/investment-operations/${buy.operation.id}`)).status).toBe(404);
  });

  it("adjusts a position to the broker's numbers and refuses a holding that is not the user's", async () => {
    const h = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" });
    await json("POST", "/v2/investment-operations", { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-09-01" });
    const adjusted = await json("POST", `/v2/holdings/${h.id}/adjust`, { currentQuantity: 8, averageCost: 31, notes: "Conferido na corretora" });
    expect(adjusted).toMatchObject({ currentQuantity: 8, averageCost: 31, totalInvested: 248, batchId: expect.any(String) });
    expect(await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: h.id, type: "adjustment" } })).toMatchObject({ notes: "Conferido na corretora" });
    const missing = await call("POST", "/v2/holdings/no-such-holding/adjust", { currentQuantity: 1, averageCost: 1 });
    expect(missing.status).toBe(404);
  });
});

describe("POST /v2/portfolio/rebalance-suggestion", () => {
  it("splits new money by class by default, by asset on request, and follows the scope", async () => {
    const h = await json("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 50 });
    await json("POST", "/v2/investment-operations", { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 50, totalAmount: 5000, date: "2026-09-01", fundFromAccountId: f.pfChecking });
    await json("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "br_stocks", targetPercent: 50 }, { allocationClass: "crypto", targetPercent: 50 }] });

    // 5000 held in stocks; 15000 more makes 20000, half of it (10000) in each class.
    const byClass = await json("POST", "/v2/portfolio/rebalance-suggestion", { amount: 15000 });
    expect(byClass.total).toBe(5000);
    expect(byClass.classes.map((c: { allocationClass: string; amount: number }) => [c.allocationClass, c.amount])).toEqual([
      ["br_stocks", 5000],
      ["crypto", 10000],
    ]);
    expect(byClass).not.toHaveProperty("assets");

    const byAsset = await json("POST", "/v2/portfolio/rebalance-suggestion", { amount: 15000, mode: "asset", scope: "pf" });
    expect(byAsset.assets.map((a: { kind: string; ticker: string | null; amount: number }) => [a.kind, a.ticker, a.amount])).toEqual([
      ["holding", "PETR4", 5000],
      ["new", null, 10000],
    ]);

    // The PJ owns none of it: nothing to measure the targets against, so the money goes by the targets alone.
    const pj = await json("POST", "/v2/portfolio/rebalance-suggestion", { amount: 1000, scope: "pj" });
    expect(pj.total).toBe(0);
    expect(pj.classes.map((c: { amount: number }) => c.amount)).toEqual([500, 500]);

    expect((await call("POST", "/v2/portfolio/rebalance-suggestion", { amount: 0 })).status).toBe(422);
    await prisma.portfolioTarget.deleteMany({ where: { userId: USER } });
    const noTargets = await call("POST", "/v2/portfolio/rebalance-suggestion", { amount: 100 });
    expect(noTargets.status).toBe(422);
    expect(await noTargets.json()).toMatchObject({ code: "rebalance.no_targets" });
  });
});
