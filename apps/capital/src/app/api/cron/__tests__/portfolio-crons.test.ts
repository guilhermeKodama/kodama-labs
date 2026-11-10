import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";

const services = vi.hoisted(() => ({
  runPortfolioSnapshots: vi.fn(async () => ({ users: 2, live: 3, closed: 1, errors: [] as { userId: string; error: string }[] })),
  refreshBenchmarks: vi.fn(async () => [
    { series: "cdi", fetched: 1, stored: 1 },
    { series: "ipca", fetched: 2, stored: 2 },
  ]),
}));
vi.mock("@capital/server/modules/investments/services/portfolio-history", () => ({ runPortfolioSnapshots: services.runPortfolioSnapshots }));
vi.mock("@capital/server/modules/investments/services/benchmarks", () => ({ refreshBenchmarks: services.refreshBenchmarks }));

import { env } from "@/env";
import { GET as benchmarks } from "../benchmarks/route";
import { GET as portfolioSnapshot } from "../portfolio-snapshot/route";

const request = (path: string, secret?: string) => new NextRequest(`http://localhost/api/cron/${path}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

// benchmarks now goes through withCron, which writes a real, global
// IntegrationRun row (job="benchmarks") on every call. GET /api/health/market-data
// reads the latest one, so this must not leave rows behind for other test
// files to trip over.
afterEach(async () => {
  await prisma.integrationRun.deleteMany({ where: { job: "benchmarks" } });
});

describe("portfolio crons", () => {
  it("refuse a request without the cron secret", async () => {
    if (!env.CRON_SECRET) return;
    expect((await portfolioSnapshot(request("portfolio-snapshot"))).status).toBe(401);
    expect((await benchmarks(request("benchmarks", "wrong"))).status).toBe(401);
    expect(services.runPortfolioSnapshots).not.toHaveBeenCalled();
    expect(services.refreshBenchmarks).not.toHaveBeenCalled();
  });

  it("portfolio-snapshot runs the snapshots and reports failed users", async () => {
    const ok = await portfolioSnapshot(request("portfolio-snapshot", env.CRON_SECRET));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, users: 2, live: 3, closed: 1 });
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 1, live: 0, closed: 0, errors: [{ userId: "u", error: "boom" }] });
    const partial = await portfolioSnapshot(request("portfolio-snapshot", env.CRON_SECRET));
    expect(await partial.json()).toMatchObject({ success: false, errors: [{ userId: "u" }] });
  });

  it("benchmarks refreshes the series; partial when one series fails, failed (503) only when every series failed", async () => {
    const ok = await benchmarks(request("benchmarks", env.CRON_SECRET));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, status: "ok", series: [{ series: "cdi" }, { series: "ipca" }] });

    services.refreshBenchmarks.mockResolvedValueOnce([
      { series: "cdi", fetched: 1, stored: 1 } as never,
      { series: "ipca", fetched: 0, stored: 0, error: "HTTP 503" } as never,
    ]);
    const partial = await benchmarks(request("benchmarks", env.CRON_SECRET));
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ success: false, status: "partial" });

    services.refreshBenchmarks.mockResolvedValueOnce([
      { series: "cdi", fetched: 0, stored: 0, error: "HTTP 503" } as never,
      { series: "ipca", fetched: 0, stored: 0, error: "HTTP 503" } as never,
    ]);
    const failed = await benchmarks(request("benchmarks", env.CRON_SECRET));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ success: false, status: "failed" });
  });
});
