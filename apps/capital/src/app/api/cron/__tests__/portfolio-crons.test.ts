import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";

const services = vi.hoisted(() => ({
  runPortfolioSnapshots: vi.fn(async () => ({ users: 2, live: 3, closed: 1, errors: [] as { userId: string; error: string }[] })),
  runNotifications: vi.fn(),
  recordMonthlySnapshots: vi.fn(),
  refreshBenchmarks: vi.fn(async () => [
    { series: "cdi", fetched: 1, stored: 1 },
    { series: "ipca", fetched: 2, stored: 2 },
  ]),
}));
vi.mock("@capital/server/modules/investments/services/portfolio-history", () => ({ runPortfolioSnapshots: services.runPortfolioSnapshots }));
vi.mock("@capital/server/modules/investments/services/benchmarks", () => ({ refreshBenchmarks: services.refreshBenchmarks }));
vi.mock("@capital/server/modules/notifications/services/notify", () => ({ runNotifications: services.runNotifications }));
vi.mock("@capital/server/modules/fire/services/record-monthly-snapshots", () => ({ recordMonthlySnapshots: services.recordMonthlySnapshots }));

import { env } from "@/env";
import { GET as benchmarks } from "../benchmarks/route";
import { GET as portfolioSnapshot } from "../portfolio-snapshot/route";
import { GET as notify } from "../notify/route";
import { GET as fireSnapshot } from "../fire-snapshot/route";

const request = (path: string, secret?: string) => new NextRequest(`http://localhost/api/cron/${path}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

// benchmarks now goes through withCron, which writes a real, global
// IntegrationRun row (job="benchmarks") on every call. GET /api/health/market-data
// reads the latest one, so this must not leave rows behind for other test
// files to trip over. "portfolio-snapshot" is not cleaned here: the run it
// writes is checked in market-data-crons.test.ts, and two files sharing a
// job name raced on its rows when they ran in parallel.
afterEach(async () => {
  await prisma.integrationRun.deleteMany({ where: { job: { in: ["benchmarks", "notify", "fire-snapshot"] } } });
});

describe("portfolio crons", () => {
  it("refuse a request without the cron secret", async () => {
    expect((await portfolioSnapshot(request("portfolio-snapshot"))).status).toBe(401);
    expect((await notify(request("notify"))).status).toBe(401);
    expect((await fireSnapshot(request("fire-snapshot", "wrong"))).status).toBe(401);
    expect(services.runNotifications).not.toHaveBeenCalled();
    expect(services.recordMonthlySnapshots).not.toHaveBeenCalled();
    expect((await benchmarks(request("benchmarks", "wrong"))).status).toBe(401);
    expect(services.runPortfolioSnapshots).not.toHaveBeenCalled();
    expect(services.refreshBenchmarks).not.toHaveBeenCalled();
  });

  it("notify and fire-snapshot record their runs", async () => {
    services.runNotifications.mockResolvedValueOnce({ users: 1, claimed: {}, alreadySent: 0, sent: 1, failed: 0, errors: [] });
    expect((await notify(request("notify", env.CRON_SECRET))).status).toBe(200);
    services.recordMonthlySnapshots.mockResolvedValueOnce({ recorded: 1, total: 1 });
    expect((await fireSnapshot(request("fire-snapshot", env.CRON_SECRET))).status).toBe(200);
    expect(await prisma.integrationRun.count({ where: { job: { in: ["notify", "fire-snapshot"] } } })).toBe(2);
  });

  it("notify maps what the dispatcher reports to the run status and HTTP code", async () => {
    const result = (over: Record<string, unknown>) => ({ users: 3, claimed: { weekly_summary: 3 }, alreadySent: 0, sent: 0, failed: 0, errors: [] as string[], ...over });

    services.runNotifications.mockResolvedValueOnce(result({ skipped: "push_not_configured" }));
    const skipped = await notify(request("notify", env.CRON_SECRET));
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ success: true, status: "skipped", skipped: "push_not_configured" });

    services.runNotifications.mockResolvedValueOnce(result({ sent: 2, failed: 1, errors: ["u3: 410"] }));
    const partial = await notify(request("notify", env.CRON_SECRET));
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ success: false, status: "partial", degraded: true, sent: 2, failed: 1 });

    services.runNotifications.mockResolvedValueOnce(result({ sent: 0, failed: 3, errors: ["boom"] }));
    const failed = await notify(request("notify", env.CRON_SECRET));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ success: false, status: "failed", failed: 3 });

    const runs = await prisma.integrationRun.findMany({ where: { job: "notify" }, orderBy: { status: "asc" } });
    expect(runs.map((r) => [r.status, r.requested, r.succeeded, r.rejected])).toEqual([
      ["failed", 3, 0, 3],
      ["partial", 3, 2, 1],
      ["skipped", 3, 0, 0],
    ]);
    expect(runs.find((r) => r.status === "partial")?.stats).toMatchObject({ claimed: { weekly_summary: 3 }, alreadySent: 0, errors: ["u3: 410"] });
  });

  it("fire-snapshot snapshots the month that just ended and maps recorded/total to the run status", async () => {
    services.recordMonthlySnapshots.mockResolvedValueOnce({ recorded: 0, total: 0 });
    const idle = await fireSnapshot(request("fire-snapshot", env.CRON_SECRET));
    expect(idle.status).toBe(200);
    expect(await idle.json()).toMatchObject({ success: true, status: "skipped", total: 0 });

    // Mid-year, to see the period and the last day of the previous month.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-03-01T03:00:00.000Z"));
      services.recordMonthlySnapshots.mockResolvedValueOnce({ recorded: 2, total: 3 });
      const partial = await fireSnapshot(request("fire-snapshot", env.CRON_SECRET));
      expect(partial.status).toBe(200);
      expect(await partial.json()).toMatchObject({ success: false, status: "partial", period: 202602, recorded: 2, total: 3 });
      const [, args] = services.recordMonthlySnapshots.mock.calls.at(-1)!;
      expect(args).toEqual({ period: 202602, snapshotDate: new Date("2026-02-28T12:00:00.000Z") });

      // January looks back to December of the year before.
      vi.setSystemTime(new Date("2027-01-01T03:00:00.000Z"));
      services.recordMonthlySnapshots.mockResolvedValueOnce({ recorded: 0, total: 4 });
      const failed = await fireSnapshot(request("fire-snapshot", env.CRON_SECRET));
      expect(failed.status).toBe(503);
      expect(await failed.json()).toMatchObject({ success: false, status: "failed", period: 202612 });
      expect(services.recordMonthlySnapshots.mock.calls.at(-1)![1]).toEqual({ period: 202612, snapshotDate: new Date("2026-12-31T12:00:00.000Z") });
    } finally {
      vi.useRealTimers();
    }
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
