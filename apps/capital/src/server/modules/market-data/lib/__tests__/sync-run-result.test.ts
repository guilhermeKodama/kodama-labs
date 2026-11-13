import { describe, expect, it } from "vitest";
import type { SyncPricesResult } from "../../services/sync-prices";
import { syncRunResult } from "../sync-run-result";

const base: SyncPricesResult = { requested: 4, priced: 3, suspect: 0, missing: 1, bySource: { alpha_vantage: 3 }, providerLatestDate: new Date("2026-11-10T00:00:00Z"), issues: [] };

describe("syncRunResult", () => {
  it("is skipped when nothing was requested", () => {
    expect(syncRunResult({ ...base, requested: 0, priced: 0, missing: 0 })).toMatchObject({ status: "skipped", requested: 0, succeeded: 0 });
  });

  it("is failed when assets were requested and none got a price, suspect ones included", () => {
    expect(syncRunResult({ ...base, requested: 2, priced: 0, suspect: 0, missing: 2 }).status).toBe("failed");
    expect(syncRunResult({ ...base, requested: 2, priced: 0, suspect: 1, missing: 1 }).status).toBe("partial");
  });

  it("is partial while some are missing and ok when none are", () => {
    expect(syncRunResult(base).status).toBe("partial");
    expect(syncRunResult({ ...base, requested: 3, missing: 0 }).status).toBe("ok");
  });

  it("counts priced and suspect as succeeded, only rejected issues as rejected, and reports the totals in the body", () => {
    const result = syncRunResult({
      ...base,
      requested: 5,
      priced: 2,
      suspect: 1,
      missing: 2,
      issues: [
        { assetId: "a", symbol: "A", outcome: "rejected", source: "alpha_vantage", error: "moeda" },
        { assetId: "b", symbol: "B", outcome: "not_found", source: "alpha_vantage" },
      ],
    });
    expect(result).toMatchObject({
      requested: 5,
      succeeded: 3,
      missing: 2,
      rejected: 1,
      providerLatestDate: new Date("2026-11-10T00:00:00Z"),
      stats: { bySource: { alpha_vantage: 3 }, suspect: 1 },
    });
    expect(result.body).toMatchObject({ message: "Synced prices for 3/5 assets", priced: 2, suspect: 1 });
  });
});
