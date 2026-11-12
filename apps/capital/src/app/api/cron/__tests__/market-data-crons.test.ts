import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const services = vi.hoisted(() => ({
  updateAllPrices: vi.fn(),
  updateAllCurrencyRates: vi.fn(),
  syncPrices: vi.fn(),
  runPortfolioSnapshots: vi.fn(async () => ({ users: 1, live: 1, closed: 0, errors: [] as { userId: string; error: string }[] })),
}));
vi.mock("@capital/server/modules/investments/services/update-prices", () => ({ updateAllPrices: services.updateAllPrices }));
vi.mock("@capital/server/modules/currencies/services/update-rates-from-api", () => ({ updateAllCurrencyRates: services.updateAllCurrencyRates }));
vi.mock("@capital/server/modules/market-data/services/sync-prices", () => ({ syncPrices: services.syncPrices }));
vi.mock("@capital/server/modules/investments/services/portfolio-history", () => ({ runPortfolioSnapshots: services.runPortfolioSnapshots }));

import { env } from "@/env";
import { prisma } from "@capital/server/lib/prisma";
import { GET as updatePrices } from "../update-prices/route";
import { GET as updateRates } from "../update-rates/route";
import { GET as syncPrices } from "../sync-prices/route";
import { GET as marketClose } from "../market-close/route";
import { GET as portfolioSnapshot } from "../portfolio-snapshot/route";

/**
 * update-prices, update-rates and sync-prices now go through withCron,
 * which writes a real, global IntegrationRun row (job="update-prices" |
 * "update-rates" | "sync-prices"). GET /api/health/market-data reads the
 * latest one, so this must not leave rows behind for other test files to
 * trip over.
 */
const JOBS = ["update-prices", "update-rates", "sync-prices", "portfolio-snapshot"];
afterEach(async () => {
  await prisma.integrationRun.deleteMany({ where: { job: { in: JOBS } } });
});

const request = (path: string, secret?: string) => new NextRequest(`http://localhost/api/cron/${path}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

describe("update-prices cron", () => {
  it("refuses a request with no or a wrong secret, without running the job", async () => {
    expect((await updatePrices(request("update-prices"))).status).toBe(401);
    expect((await updatePrices(request("update-prices", "wrong"))).status).toBe(401);
    expect(services.updateAllPrices).not.toHaveBeenCalled();
    expect(await prisma.integrationRun.count({ where: { job: "update-prices" } })).toBe(0);
  });

  it("is skipped (not failed) when nothing could be attempted at all", async () => {
    services.updateAllPrices.mockResolvedValueOnce({
      totalHoldings: 2,
      updated: 0,
      failed: 0,
      missing: [],
      bySource: { coingecko: 0, brapi: 0, yahoo: 0 },
      issues: [
        { holdingId: "h1", ticker: null, reason: "no_ticker" },
        { holdingId: "h2", ticker: "CDB", reason: "no_source" },
      ],
      latestQuoteAt: null,
    });
    const res = await updatePrices(request("update-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "skipped" });
    expect(await prisma.integrationRun.findFirstOrThrow({ where: { job: "update-prices" } })).toMatchObject({ status: "skipped", requested: 0, succeeded: 0 });
  });

  it("is failed (503) when something was attempted but nothing updated", async () => {
    services.updateAllPrices.mockResolvedValueOnce({
      totalHoldings: 1,
      updated: 0,
      failed: 0,
      missing: ["ZZZZ9"],
      bySource: { coingecko: 0, brapi: 0, yahoo: 0 },
      issues: [{ holdingId: "h1", ticker: "ZZZZ9", reason: "not_found" }],
      latestQuoteAt: null,
    });
    const res = await updatePrices(request("update-prices", env.CRON_SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, status: "failed" });
  });

  it("is partial (still 200) when some tickers are missing but others updated", async () => {
    services.updateAllPrices.mockResolvedValueOnce({
      totalHoldings: 2,
      updated: 1,
      failed: 0,
      missing: ["ZZZZ9"],
      bySource: { coingecko: 0, brapi: 1, yahoo: 0 },
      issues: [{ holdingId: "h2", ticker: "ZZZZ9", reason: "not_found" }],
      latestQuoteAt: "2026-10-05T17:32:00.000Z",
    });
    const res = await updatePrices(request("update-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, status: "partial", updated: 1, totalHoldings: 2 });
    expect(await prisma.integrationRun.findFirstOrThrow({ where: { job: "update-prices" } })).toMatchObject({ status: "partial", providerLatestDate: new Date("2026-10-05T17:32:00.000Z") });
  });

  it("is ok (200) when everything priceable was priced", async () => {
    services.updateAllPrices.mockResolvedValueOnce({
      totalHoldings: 1,
      updated: 1,
      failed: 0,
      missing: [],
      bySource: { coingecko: 0, brapi: 1, yahoo: 0 },
      issues: [],
      latestQuoteAt: "2026-10-05T17:32:00.000Z",
    });
    const res = await updatePrices(request("update-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "ok" });
  });
});

describe("update-rates cron", () => {
  it("refuses a request with no or a wrong secret, without running the job", async () => {
    expect((await updateRates(request("update-rates"))).status).toBe(401);
    expect((await updateRates(request("update-rates", "wrong"))).status).toBe(401);
    expect(services.updateAllCurrencyRates).not.toHaveBeenCalled();
  });

  it("is skipped when nothing was requested", async () => {
    services.updateAllCurrencyRates.mockResolvedValueOnce({ usersProcessed: 0, ratesRequested: 0, ratesUpdated: 0, ratesUnchanged: 0, manualSkipped: 0, errors: 0 });
    const res = await updateRates(request("update-rates", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "skipped" });
  });

  it("is failed (503) when every provider call errored", async () => {
    services.updateAllCurrencyRates.mockResolvedValueOnce({ usersProcessed: 1, ratesRequested: 1, ratesUpdated: 0, ratesUnchanged: 0, manualSkipped: 0, errors: 1 });
    const res = await updateRates(request("update-rates", env.CRON_SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, status: "failed" });
  });

  it("is partial when some provider calls errored but others updated", async () => {
    services.updateAllCurrencyRates.mockResolvedValueOnce({ usersProcessed: 2, ratesRequested: 3, ratesUpdated: 1, ratesUnchanged: 1, manualSkipped: 0, errors: 1 });
    const res = await updateRates(request("update-rates", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, status: "partial" });
  });

  it("is ok when nothing errored", async () => {
    services.updateAllCurrencyRates.mockResolvedValueOnce({ usersProcessed: 2, ratesRequested: 2, ratesUpdated: 2, ratesUnchanged: 0, manualSkipped: 0, errors: 0 });
    const res = await updateRates(request("update-rates", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "ok" });
  });
});

describe("sync-prices cron", () => {
  it("refuses a request with no or a wrong secret, without running the job", async () => {
    expect((await syncPrices(request("sync-prices"))).status).toBe(401);
    expect((await syncPrices(request("sync-prices", "wrong"))).status).toBe(401);
    expect(services.syncPrices).not.toHaveBeenCalled();
    expect(await prisma.integrationRun.count({ where: { job: "sync-prices" } })).toBe(0);
  });

  it("is skipped (not failed) when there is nothing to sync yet", async () => {
    services.syncPrices.mockResolvedValueOnce({ requested: 0, priced: 0, suspect: 0, missing: 0, bySource: {}, providerLatestDate: null, issues: [] });
    const res = await syncPrices(request("sync-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "skipped" });
    expect(await prisma.integrationRun.findFirstOrThrow({ where: { job: "sync-prices" } })).toMatchObject({ status: "skipped", requested: 0, succeeded: 0 });
  });

  it("is failed (503) when something was requested but nothing priced", async () => {
    services.syncPrices.mockResolvedValueOnce({
      requested: 1,
      priced: 0,
      suspect: 0,
      missing: 1,
      bySource: {},
      providerLatestDate: null,
      issues: [{ assetId: "a1", symbol: "ZZZZ9", outcome: "not_found", source: "brapi" }],
    });
    const res = await syncPrices(request("sync-prices", env.CRON_SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, status: "failed" });
  });

  it("is partial (still 200) when some assets are missing but others were priced", async () => {
    services.syncPrices.mockResolvedValueOnce({
      requested: 2,
      priced: 1,
      suspect: 0,
      missing: 1,
      bySource: { brapi: 1 },
      providerLatestDate: new Date("2026-11-10T00:00:00Z"),
      issues: [{ assetId: "a2", symbol: "ZZZZ9", outcome: "not_found", source: "brapi" }],
    });
    const res = await syncPrices(request("sync-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, status: "partial" });
    expect(await prisma.integrationRun.findFirstOrThrow({ where: { job: "sync-prices" } })).toMatchObject({ status: "partial", providerLatestDate: new Date("2026-11-10T00:00:00Z") });
  });

  it("is ok (200) when everything requested was priced, suspect prices counting as succeeded", async () => {
    services.syncPrices.mockResolvedValueOnce({
      requested: 2,
      priced: 1,
      suspect: 1,
      missing: 0,
      bySource: { brapi: 1, yahoo: 1 },
      providerLatestDate: new Date("2026-11-10T00:00:00Z"),
      issues: [],
    });
    const res = await syncPrices(request("sync-prices", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "ok" });
    expect(await prisma.integrationRun.findFirstOrThrow({ where: { job: "sync-prices" } })).toMatchObject({ status: "ok", requested: 2, succeeded: 2 });
  });
});

describe("portfolio-snapshot cron", () => {
  it("runs the snapshots and reports failed users", async () => {
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 2, live: 3, closed: 1, errors: [] });
    const ok = await portfolioSnapshot(request("portfolio-snapshot", env.CRON_SECRET));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, users: 2, live: 3, closed: 1 });
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 1, live: 0, closed: 0, errors: [{ userId: "u", error: "boom" }] });
    const failed = await portfolioSnapshot(request("portfolio-snapshot", env.CRON_SECRET));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ success: false, status: "failed", errors: [{ userId: "u" }] });
    expect(await prisma.integrationRun.count({ where: { job: "portfolio-snapshot" } })).toBe(2);
  });
});

describe("market-close pipeline", () => {
  const syncOk = { requested: 2, priced: 2, suspect: 0, missing: 0, bySource: { yahoo: 2 }, providerLatestDate: new Date("2026-11-10T00:00:00Z"), issues: [] };
  const updateOk = { totalHoldings: 2, updated: 2, failed: 0, missing: [], bySource: { yahoo: 2 }, issues: [], latestQuoteAt: "2026-11-10T20:07:00.000Z" };

  it("refuses a request without the secret, running no stage", async () => {
    services.syncPrices.mockClear();
    expect((await marketClose(request("market-close"))).status).toBe(401);
    expect(services.syncPrices).not.toHaveBeenCalled();
    expect(await prisma.integrationRun.count({ where: { job: { in: JOBS } } })).toBe(0);
  });

  it("runs sync-prices, update-prices and portfolio-snapshot in that order, one IntegrationRun each", async () => {
    const order: string[] = [];
    services.syncPrices.mockImplementationOnce(async () => (order.push("sync"), syncOk));
    services.updateAllPrices.mockImplementationOnce(async () => (order.push("update"), updateOk));
    services.runPortfolioSnapshots.mockImplementationOnce(async () => (order.push("snapshot"), { users: 1, live: 1, closed: 0, errors: [] }));

    const res = await marketClose(request("market-close", env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(order).toEqual(["sync", "update", "snapshot"]);
    expect(await res.json()).toMatchObject({ status: "ok", stages: [{ job: "sync-prices", status: "ok" }, { job: "update-prices", status: "ok" }, { job: "portfolio-snapshot", status: "ok" }] });
    const runs = await prisma.integrationRun.findMany({ where: { job: { in: JOBS } }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => [r.job, r.trigger, r.status])).toEqual([
      ["sync-prices", "cron", "ok"],
      ["update-prices", "cron", "ok"],
      ["portfolio-snapshot", "cron", "ok"],
    ]);
  });

  it("keeps going after a failed stage and answers 503 with the worst status", async () => {
    services.syncPrices.mockResolvedValueOnce({ ...syncOk, priced: 0, missing: 2, issues: [{ assetId: "a", symbol: "X", outcome: "provider_down", source: "yahoo" }] });
    services.updateAllPrices.mockResolvedValueOnce(updateOk);
    const res = await marketClose(request("market-close", env.CRON_SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "failed", error: "failed: sync-prices" });
    expect(services.runPortfolioSnapshots).toHaveBeenCalled();
    expect(await prisma.integrationRun.count({ where: { job: "portfolio-snapshot" } })).toBe(1);
  });
});

