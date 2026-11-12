import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeProviderContract } from "../../lib/__tests__/provider-contract";
import { coingeckoProvider } from "../coingecko";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Scenario = "ok" | "not_found" | "rate_limited" | "provider_down" | "schema_changed";
let scenario: Scenario = "ok";

const fetchMock = vi.fn(async () => {
  if (scenario === "rate_limited") return new Response("", { status: 429, headers: { "retry-after": "999999" } });
  if (scenario === "provider_down") return new Response("boom", { status: 500 });
  if (scenario === "schema_changed") return json([1, 2, 3]); // an array, not an object keyed by coin id
  if (scenario === "not_found") return json({ bitcoin: {} });
  return json({ bitcoin: { usd: 65000, last_updated_at: 1791222720 } });
});

beforeEach(() => {
  scenario = "ok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describeProviderContract(coingeckoProvider, {
  validExternalId: "bitcoin:usd",
  searchQuery: "BTC",
  arrangeOk: () => (scenario = "ok"),
  arrangeNotFound: () => (scenario = "not_found"),
  arrangeRateLimited: () => (scenario = "rate_limited"),
  arrangeProviderDown: () => (scenario = "provider_down"),
  arrangeSchemaChanged: () => (scenario = "schema_changed"),
});

describe("coingeckoProvider.fetchPrices", () => {
  it("is not_found for an externalId with no currency suffix", async () => {
    scenario = "ok";
    const result = await coingeckoProvider.fetchPrices!("bitcoin", { from: "2026-01-01", to: "2026-01-01" });
    expect(result.outcome).toBe("not_found");
  });

  it("prices in whatever currency the externalId names", async () => {
    scenario = "ok";
    const result = await coingeckoProvider.fetchPrices!("bitcoin:usd", { from: "2026-01-01", to: "2026-01-01" });
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") expect(result.data[0]).toMatchObject({ close: 65000, currency: "USD" });
  });
});
