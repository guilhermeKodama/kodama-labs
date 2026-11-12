import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import type { PriceUpdateResult } from "@capital/server/modules/investments/services/update-prices";
import type { SyncPricesResult } from "../sync-prices";

const services = vi.hoisted(() => ({
  syncPrices: vi.fn(),
  updateAllPrices: vi.fn(),
  runPortfolioSnapshots: vi.fn(),
}));
vi.mock("../sync-prices", () => ({ syncPrices: services.syncPrices }));
vi.mock("@capital/server/modules/investments/services/update-prices", () => ({ updateAllPrices: services.updateAllPrices }));
vi.mock("@capital/server/modules/investments/services/portfolio-history", () => ({ runPortfolioSnapshots: services.runPortfolioSnapshots }));

import { portfolioSnapshotStage, syncPricesStage, updatePricesStage } from "../market-close";

// The stages only pass the client through to the (mocked) services.
const db = {} as DbClient;

beforeEach(() => {
  services.syncPrices.mockReset();
  services.updateAllPrices.mockReset();
  services.runPortfolioSnapshots.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function priceUpdate(patch: Partial<PriceUpdateResult>): PriceUpdateResult {
  return { totalHoldings: 0, updated: 0, failed: 0, missing: [], bySource: {}, issues: [], latestQuoteAt: null, ...patch };
}

describe("syncPricesStage", () => {
  it("turns the service's result into the run result and hands the client to the service", async () => {
    const sync: SyncPricesResult = { requested: 2, priced: 1, suspect: 0, missing: 1, bySource: { yahoo: 1 }, providerLatestDate: new Date("2026-11-10T00:00:00Z"), issues: [] };
    services.syncPrices.mockResolvedValueOnce(sync);
    const run = await syncPricesStage(db);
    expect(services.syncPrices).toHaveBeenCalledWith(db);
    expect(run).toMatchObject({ status: "partial", requested: 2, succeeded: 1, missing: 1, providerLatestDate: new Date("2026-11-10T00:00:00Z") });
  });
});

describe("updatePricesStage", () => {
  it("is skipped when every holding was never attempted (no ticker or no source)", async () => {
    services.updateAllPrices.mockResolvedValueOnce(
      priceUpdate({
        totalHoldings: 2,
        issues: [
          { holdingId: "h1", ticker: null, reason: "no_ticker" },
          { holdingId: "h2", ticker: "CDB", reason: "no_source" },
        ],
      }),
    );
    expect(await updatePricesStage(db)).toMatchObject({ status: "skipped", requested: 0, succeeded: 0, missing: 0, rejected: 0, providerLatestDate: null });
  });

  it("is failed when holdings were attempted and none updated", async () => {
    services.updateAllPrices.mockResolvedValueOnce(
      priceUpdate({ totalHoldings: 1, missing: ["ZZZZ9"], issues: [{ holdingId: "h1", ticker: "ZZZZ9", reason: "no_price_cached" }] }),
    );
    expect(await updatePricesStage(db)).toMatchObject({ status: "failed", requested: 1, succeeded: 0, missing: 1 });
  });

  it("is partial when some updated and some tickers are missing", async () => {
    services.updateAllPrices.mockResolvedValueOnce(priceUpdate({ totalHoldings: 2, updated: 1, missing: ["ZZZZ9"], latestQuoteAt: "2026-11-10T22:00:00.000Z" }));
    expect(await updatePricesStage(db)).toMatchObject({
      status: "partial",
      requested: 2,
      succeeded: 1,
      missing: 1,
      providerLatestDate: new Date("2026-11-10T22:00:00.000Z"),
    });
  });

  it("is partial when some updated and a write failed, counting the failure as rejected", async () => {
    services.updateAllPrices.mockResolvedValueOnce(priceUpdate({ totalHoldings: 2, updated: 1, failed: 1 }));
    expect(await updatePricesStage(db)).toMatchObject({ status: "partial", rejected: 1 });
  });

  it("is ok when every attempted holding updated, and puts the service's result in the body", async () => {
    services.updateAllPrices.mockResolvedValueOnce(
      priceUpdate({ totalHoldings: 3, updated: 2, bySource: { yahoo: 2 }, issues: [{ holdingId: "h3", ticker: null, reason: "no_ticker" }] }),
    );
    const run = await updatePricesStage(db);
    expect(run).toMatchObject({ status: "ok", requested: 2, succeeded: 2, stats: { bySource: { yahoo: 2 } } });
    expect(run.body).toMatchObject({ message: "Updated prices for 2/3 holdings", updated: 2, totalHoldings: 3 });
  });
});

describe("portfolioSnapshotStage", () => {
  it("is skipped when there are no users to snapshot", async () => {
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 0, live: 0, closed: 0, errors: [] });
    expect(await portfolioSnapshotStage(db)).toMatchObject({ status: "skipped", requested: 0, succeeded: 0, missing: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("is ok when every user was snapshotted", async () => {
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 2, live: 3, closed: 1, errors: [] });
    const run = await portfolioSnapshotStage(db);
    expect(run).toMatchObject({ status: "ok", requested: 2, succeeded: 2, missing: 0, stats: { live: 3, closed: 1, errors: [] } });
    expect(run.body).toEqual({ users: 2, live: 3, closed: 1, errors: [] });
  });

  it("is partial when some users failed, and logs them", async () => {
    const errors = [{ userId: "u1", error: "boom" }];
    services.runPortfolioSnapshots.mockResolvedValueOnce({ users: 2, live: 1, closed: 0, errors });
    expect(await portfolioSnapshotStage(db)).toMatchObject({ status: "partial", requested: 2, succeeded: 1, missing: 1 });
    expect(console.error).toHaveBeenCalledWith("[PortfolioSnapshot] failed users:", errors);
  });

  it("is failed when every user failed", async () => {
    services.runPortfolioSnapshots.mockResolvedValueOnce({
      users: 2,
      live: 0,
      closed: 0,
      errors: [
        { userId: "u1", error: "boom" },
        { userId: "u2", error: "boom" },
      ],
    });
    expect(await portfolioSnapshotStage(db)).toMatchObject({ status: "failed", requested: 2, succeeded: 0, missing: 2 });
  });
});
