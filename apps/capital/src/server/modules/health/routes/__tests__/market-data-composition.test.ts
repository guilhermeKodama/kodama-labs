import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Run = { status: string; startedAt: Date; finishedAt: Date | null };
type Row = { ticker: string | null; assetClass: string; currentPrice: number | null; lastPriceUpdate: Date | null };

const db = vi.hoisted(() => ({ runs: new Map<string, unknown>(), holdings: [] as unknown[], lookups: [] as unknown[] }));
vi.mock("@capital/server/lib/prisma", () => ({
  prisma: {
    integrationRun: {
      findFirst: vi.fn(async (args: { where: { job: string } }) => {
        db.lookups.push(args);
        return db.runs.get(args.where.job) ?? null;
      }),
    },
    investmentHolding: { findMany: vi.fn(async () => db.holdings) },
  },
}));

import marketDataHealth from "../market-data";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const HOUR = 3_600_000;
const JOBS = ["sync-prices", "update-prices", "portfolio-snapshot", "update-rates", "benchmarks", "pluggy-sync"];

const ok = (hoursAgo: number, finished = true): Run => ({
  status: "ok",
  startedAt: new Date(NOW.getTime() - hoursAgo * HOUR - (finished ? HOUR / 2 : 0)),
  finishedAt: finished ? new Date(NOW.getTime() - hoursAgo * HOUR) : null,
});
const allFresh = () => JOBS.forEach((job) => db.runs.set(job, ok(1)));
const get = async () => {
  const res = await marketDataHealth.request("/health/market-data");
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  db.runs.clear();
  db.holdings = [];
  db.lookups = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /health/market-data, with the database stubbed", () => {
  it("looks at the last scheduled run of each job and reports them in order, 200 when all are fresh", async () => {
    allFresh();

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.jobs.map((job: { job: string }) => job.job)).toEqual(JOBS);
    expect(body.jobs[0]).toEqual({ job: "sync-prices", status: "ok", lastRunAt: new Date(NOW.getTime() - HOUR).toISOString(), lastRunStatus: "ok", ageHours: 1, targetHours: 26 });
    expect(body.jobs.map((job: { targetHours: number }) => job.targetHours)).toEqual([26, 26, 26, 3, 30, 30]);
    expect(db.lookups).toHaveLength(JOBS.length);
    for (const job of JOBS) {
      expect(db.lookups).toContainEqual({ where: { job, trigger: "cron" }, orderBy: { startedAt: "desc" } });
    }
  });

  it("dates a run that has not finished by when it started, and rounds its age to a tenth of an hour", async () => {
    allFresh();
    db.runs.set("update-rates", { status: "ok", startedAt: new Date(NOW.getTime() - 2.54 * HOUR), finishedAt: null });

    const { body } = await get();

    const rates = body.jobs.find((job: { job: string }) => job.job === "update-rates");
    expect(rates).toMatchObject({ status: "ok", lastRunAt: new Date(NOW.getTime() - 2.54 * HOUR).toISOString(), ageHours: 2.5 });
  });

  it("is 503 and 'down' when a job has never run, with nothing to say about its last run", async () => {
    allFresh();
    db.runs.delete("pluggy-sync");

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.jobs.find((job: { job: string }) => job.job === "pluggy-sync")).toEqual({ job: "pluggy-sync", status: "down", lastRunAt: null, lastRunStatus: null, ageHours: null, targetHours: 30 });
  });

  it("is degraded but still 200 for a partial run or a job past its target", async () => {
    allFresh();
    db.runs.set("benchmarks", { ...ok(1), status: "partial" });
    db.runs.set("update-rates", ok(4));

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    const byJob = Object.fromEntries(body.jobs.map((job: { job: string; status: string }) => [job.job, job.status]));
    expect(byJob).toMatchObject({ benchmarks: "degraded", "update-rates": "degraded", "sync-prices": "ok" });
  });

  it("breaks the holdings down by price status and class, and finds the oldest quote among them", async () => {
    allFresh();
    const rows: Row[] = [
      { ticker: "PETR4", assetClass: "stocks", currentPrice: 30, lastPriceUpdate: new Date(NOW.getTime() - 5 * HOUR) },
      { ticker: "VALE3", assetClass: "stocks", currentPrice: 60, lastPriceUpdate: new Date(NOW.getTime() - 50 * HOUR) },
      { ticker: "ITUB4", assetClass: "stocks", currentPrice: 20, lastPriceUpdate: new Date(NOW.getTime() - 10 * HOUR) },
      { ticker: "WEGE3", assetClass: "stocks", currentPrice: null, lastPriceUpdate: null },
      { ticker: null, assetClass: "stocks", currentPrice: null, lastPriceUpdate: null },
      { ticker: "CDB1", assetClass: "fixed_income", currentPrice: null, lastPriceUpdate: null },
    ];
    db.holdings = rows;

    const { body } = await get();

    const { holdings } = body;
    expect(holdings.total).toBe(6);
    expect(holdings.byStatus).toMatchObject({ unpriced: 1, no_ticker: 1, unsupported: 1 });
    expect(holdings.byStatus.fresh + holdings.byStatus.stale).toBe(3);
    // Priceable is what a source could price: everything but the holding without a ticker and the one of an unsupported class.
    expect(holdings.priceable).toBe(4);
    expect(holdings.stale).toBe(holdings.byStatus.stale);
    expect(holdings.oldestPriceAt).toBe(new Date(NOW.getTime() - 50 * HOUR).toISOString());
    expect(holdings.byAssetClass.stocks).toMatchObject({ total: 5, noTicker: 1, unpriced: 1, priceable: 4 });
    expect(holdings.byAssetClass.fixed_income).toMatchObject({ total: 1, unsupported: 1, priceable: 0, activeProvider: null });
    expect(holdings.byAssetClass.crypto).toMatchObject({ total: 0, priceable: 0, fresh: 0, stale: 0 });
  });

  it("has no oldest price when no holding has ever been priced", async () => {
    allFresh();
    db.holdings = [{ ticker: "WEGE3", assetClass: "stocks", currentPrice: null, lastPriceUpdate: null }];
    expect((await get()).body.holdings).toMatchObject({ total: 1, oldestPriceAt: null, stale: 0 });
    db.holdings = [];
    expect((await get()).body.holdings).toMatchObject({ total: 0, priceable: 0, oldestPriceAt: null });
  });
});
