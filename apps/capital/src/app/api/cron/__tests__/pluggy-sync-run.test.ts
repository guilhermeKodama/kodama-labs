import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * pluggy-sync fans out over every user with a saved item. Prisma and the
 * Pluggy modules are replaced so the test sees the IntegrationRun the route
 * records without touching the shared database or the network.
 */
const mocks = vi.hoisted(() => ({
  isPluggyConfigured: vi.fn(),
  createPluggyClient: vi.fn(),
  safeSyncError: vi.fn(),
  anthropicIncomeGuesser: vi.fn(),
  syncPluggy: vi.fn(),
  findItems: vi.fn(),
  createRun: vi.fn(),
}));

vi.mock("@capital/server/lib/prisma", () => ({
  prisma: {
    pluggyItem: { findMany: mocks.findItems },
    integrationRun: { create: mocks.createRun },
  },
}));
vi.mock("@capital/server/modules/pluggy/lib/config", () => ({ isPluggyConfigured: mocks.isPluggyConfigured }));
vi.mock("@capital/server/modules/pluggy/lib/client", () => ({
  createPluggyClient: mocks.createPluggyClient,
  safeSyncError: mocks.safeSyncError,
}));
vi.mock("@capital/server/modules/pluggy/lib/guesser", () => ({ anthropicIncomeGuesser: mocks.anthropicIncomeGuesser }));
vi.mock("@capital/server/modules/pluggy/services/sync", () => ({ syncPluggy: mocks.syncPluggy }));

import { env } from "@/env";
import { GET } from "../pluggy-sync/route";

const authed = () => new NextRequest("http://localhost/api/cron/pluggy-sync", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });

const okReport = (itemStatuses: string[] = ["ok"]) => ({ status: "ok", items: itemStatuses.map((status, i) => ({ id: `item-${i}`, status })) });

/** The data of the single IntegrationRun the route wrote. */
const recordedRun = () => {
  expect(mocks.createRun).toHaveBeenCalledTimes(1);
  return mocks.createRun.mock.calls[0][0].data as Record<string, unknown>;
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.isPluggyConfigured.mockReturnValue(true);
  mocks.createPluggyClient.mockReturnValue({ client: true });
  mocks.anthropicIncomeGuesser.mockReturnValue({ guesser: true });
  mocks.safeSyncError.mockImplementation((e: unknown) => (e instanceof Error ? e.message : "unknown"));
  mocks.createRun.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("pluggy-sync cron run", () => {
  it("records a skipped run when Pluggy is not configured and never reads the items", async () => {
    mocks.isPluggyConfigured.mockReturnValue(false);

    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "disabled", message: "Pluggy is not configured" });
    expect(mocks.findItems).not.toHaveBeenCalled();
    expect(recordedRun()).toMatchObject({ job: "pluggy-sync", status: "skipped" });
  });

  it("records a skipped run when no user has an item", async () => {
    mocks.findItems.mockResolvedValue([]);

    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "idle", users: 0 });
    expect(mocks.syncPluggy).not.toHaveBeenCalled();
    expect(recordedRun()).toMatchObject({ status: "skipped" });
  });

  it("syncs every user as a cron trigger and records an ok run", async () => {
    mocks.findItems.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    mocks.syncPluggy.mockResolvedValue(okReport());

    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "ok", users: 2 });
    expect(mocks.syncPluggy).toHaveBeenCalledTimes(2);
    expect(mocks.syncPluggy.mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
    const [, deps, opts] = mocks.syncPluggy.mock.calls[0];
    expect(deps).toMatchObject({ client: { client: true }, guesser: { guesser: true } });
    expect(deps.now).toBeInstanceOf(Date);
    expect(opts).toEqual({ trigger: "cron" });
    expect(recordedRun()).toMatchObject({ status: "ok", requested: 2, succeeded: 2, rejected: 0, error: null });
  });

  // The route's own body carries status "ok" and overrides the run status in the JSON
  // (see the report); the HTTP code, success/degraded flags and the recorded run are the contract here.
  it("is partial (still a 200) when one user throws and the others sync; the error message is the sanitized one", async () => {
    mocks.findItems.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    mocks.syncPluggy.mockRejectedValueOnce(new Error("token expired")).mockResolvedValueOnce(okReport());

    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, degraded: true, users: 1, error: "token expired" });
    expect(mocks.safeSyncError).toHaveBeenCalledTimes(1);
    expect(recordedRun()).toMatchObject({
      status: "partial",
      requested: 2,
      succeeded: 1,
      rejected: 1,
      error: "token expired",
      stats: { userErrors: ["token expired"], itemErrors: 0 },
    });
  });

  it("is partial when every user syncs but an item reports an error", async () => {
    mocks.findItems.mockResolvedValue([{ userId: "u1" }]);
    mocks.syncPluggy.mockResolvedValue(okReport(["ok", "error", "error"]));

    const res = await GET(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, degraded: true, users: 1 });
    expect(recordedRun()).toMatchObject({ status: "partial", succeeded: 1, rejected: 2, error: null, stats: { userErrors: [], itemErrors: 2 } });
  });

  it("is failed (503) when every user throws", async () => {
    mocks.findItems.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    mocks.syncPluggy.mockRejectedValue(new Error("pluggy down"));

    const res = await GET(authed());

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, error: "pluggy down" });
    expect(recordedRun()).toMatchObject({ status: "failed", requested: 2, succeeded: 0, rejected: 2 });
  });

  it("answers 401 without writing a run when the secret is wrong", async () => {
    const res = await GET(new NextRequest("http://localhost/api/cron/pluggy-sync", { headers: { authorization: "Bearer wrong" } }));

    expect(res.status).toBe(401);
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.findItems).not.toHaveBeenCalled();
  });
});
