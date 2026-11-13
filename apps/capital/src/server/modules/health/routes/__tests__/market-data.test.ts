import { describe, expect, it } from "vitest";
import { createApp } from "@capital/server/lib/create-app";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { brapiHasToken } from "@capital/server/modules/market-data/lib/registry";
import { evaluateJobStatus, overallStatus } from "../market-data";

const NOW = new Date("2026-01-10T00:00:00Z").getTime();
const HOUR = 3_600_000;

describe("evaluateJobStatus (pure: no IntegrationRun row is global and shared with every other cron-route test, so this is unit-tested directly)", () => {
  it("is down with no run at all", () => {
    expect(evaluateJobStatus(null, 8, NOW)).toEqual({ status: "down", ageHours: null });
  });

  it("is ok within its target", () => {
    const last = { status: "ok", startedAt: new Date(NOW - 1 * HOUR), finishedAt: new Date(NOW - 1 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW)).toEqual({ status: "ok", ageHours: 1 });
  });

  it("is degraded when the last run was partial, even if recent", () => {
    const last = { status: "partial", startedAt: new Date(NOW - 1 * HOUR), finishedAt: new Date(NOW - 1 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW).status).toBe("degraded");
  });

  it("is degraded once past its target but within twice it", () => {
    const last = { status: "ok", startedAt: new Date(NOW - 10 * HOUR), finishedAt: new Date(NOW - 10 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW).status).toBe("degraded");
  });

  it("is down once past twice its target, even if the run reported ok", () => {
    const last = { status: "ok", startedAt: new Date(NOW - 20 * HOUR), finishedAt: new Date(NOW - 20 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW).status).toBe("down");
  });

  it("is down on a failed run that is also stale", () => {
    const last = { status: "failed", startedAt: new Date(NOW - 9 * HOUR), finishedAt: new Date(NOW - 9 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW).status).toBe("down");
  });

  it("a failed run that is still fresh (the next run may fix it) is degraded, not down", () => {
    const last = { status: "failed", startedAt: new Date(NOW - 1 * HOUR), finishedAt: new Date(NOW - 1 * HOUR) };
    expect(evaluateJobStatus(last, 8, NOW).status).toBe("degraded");
  });
});

describe("overallStatus (pure)", () => {
  it("is the worst of the per-job statuses", () => {
    expect(overallStatus([{ status: "ok" }, { status: "ok" }])).toBe("ok");
    expect(overallStatus([{ status: "ok" }, { status: "degraded" }])).toBe("degraded");
    expect(overallStatus([{ status: "degraded" }, { status: "down" }])).toBe("down");
  });
});

describe("GET /api/health/market-data", () => {
  const app = createApp();

  it("answers with one entry per job and the holdings block, 200 or 503", async () => {
    const res = await app.request("/api/health/market-data");
    expect([200, 503]).toContain(res.status);
    const body = await res.json();
    expect(["ok", "degraded", "down"]).toContain(body.status);
    expect(body.jobs).toEqual(
      expect.arrayContaining(["sync-prices", "update-prices", "update-rates", "benchmarks", "pluggy-sync"].map((job) => expect.objectContaining({ job }))),
    );
    expect(body.holdings).toMatchObject({ total: expect.any(Number), priceable: expect.any(Number), stale: expect.any(Number) });
  });

  it("breaks holdings down by asset class, with the registry's active provider for each", async () => {
    const res = await app.request("/api/health/market-data");
    const body = await res.json();
    // B3 is brapi even without a token (demo tickers only); the panel says so. International listings are Alpha Vantage.
    expect(body.holdings.byAssetClass).toMatchObject({
      stocks: { activeProvider: "brapi" },
      international_stocks: { activeProvider: "alpha_vantage" },
      international_etf: { activeProvider: "alpha_vantage" },
      crypto: { activeProvider: "coingecko" },
      fixed_income: { activeProvider: null },
      savings: { activeProvider: null },
    });
    expect(body.notices).toEqual(brapiHasToken() ? [] : ["brapi_no_token"]);
    for (const assetClass of Object.keys(body.holdings.byAssetClass)) {
      expect(body.holdings.byAssetClass[assetClass]).toMatchObject({ total: expect.any(Number), priceable: expect.any(Number) });
    }
  });

  it("counts a stale, a no-ticker and an unsupported-class holding under their own asset class", async () => {
    const userId = "test-user-health-market-data-byclass-001";
    const f: LedgerFixture = await createLedgerFixture(prisma, userId);
    try {
      const before = (await (await app.request("/api/health/market-data")).json()).holdings.byAssetClass.stocks;
      const beforeFixed = (await (await app.request("/api/health/market-data")).json()).holdings.byAssetClass.fixed_income;

      const stale = await createHolding(userId, { accountId: f.broker, assetClass: "stocks", ticker: "ZZZZ8", name: "Stale Co" }, prisma);
      await prisma.investmentHolding.update({ where: { id: stale.id }, data: { currentPrice: 10, lastPriceUpdate: new Date(NOW - 100 * HOUR) } });
      await createHolding(userId, { accountId: f.broker, assetClass: "stocks", name: "Sem ticker" }, prisma);
      await createHolding(userId, { accountId: f.broker, assetClass: "fixed_income", ticker: "CDB999", name: "CDB" }, prisma);

      const body = await (await app.request("/api/health/market-data")).json();
      expect(body.holdings.byAssetClass.stocks).toMatchObject({
        total: before.total + 2,
        stale: before.stale + 1,
        noTicker: before.noTicker + 1,
      });
      expect(body.holdings.byAssetClass.fixed_income).toMatchObject({
        total: beforeFixed.total + 1,
        unsupported: beforeFixed.unsupported + 1,
        priceable: beforeFixed.priceable,
      });
    } finally {
      await deleteLedgerFixture(prisma, userId);
    }
  });

  it("reports a holding stuck without a fresh price, independent of the jobs' own status", async () => {
    const userId = "test-user-health-market-data-001";
    const f: LedgerFixture = await createLedgerFixture(prisma, userId);
    try {
      const before = (await (await app.request("/api/health/market-data")).json()).holdings.stale;
      const stale = await createHolding(userId, { accountId: f.broker, assetClass: "stocks", ticker: "ZZZZ9", name: "Stale Co" }, prisma);
      await prisma.investmentHolding.update({ where: { id: stale.id }, data: { currentPrice: 10, lastPriceUpdate: new Date(NOW - 100 * HOUR) } });
      const after = (await (await app.request("/api/health/market-data")).json()).holdings.stale;
      expect(after).toBe(before + 1);
    } finally {
      await deleteLedgerFixture(prisma, userId);
    }
  });
});
