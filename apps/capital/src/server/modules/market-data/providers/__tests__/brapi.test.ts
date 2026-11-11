import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeProviderContract } from "../../lib/__tests__/provider-contract";
import { brapiAssetClass, brapiProvider } from "../brapi";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Scenario = "ok" | "not_found" | "rate_limited" | "provider_down" | "schema_changed";
let scenario: Scenario = "ok";

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (scenario === "rate_limited") return new Response("", { status: 429, headers: { "retry-after": "999999" } });
  if (scenario === "provider_down") return new Response("boom", { status: 500 });
  if (scenario === "schema_changed") return new Response("not json at all {", { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://brapi.dev/api/quote/list")) {
    return json({ stocks: [{ stock: "BOVA11", name: "ISHARES BOVA CI", close: 128.4, type: "fund" }] });
  }
  if (url.startsWith("https://brapi.dev/api/quote/")) {
    if (scenario === "not_found") return json({ results: [] });
    return json({ results: [{ symbol: "PETR4", regularMarketPrice: 38.2, currency: "BRL", regularMarketTime: "2026-10-05T17:32:00.000Z" }] });
  }
  return json({}, 404);
});

beforeEach(() => {
  scenario = "ok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describeProviderContract(brapiProvider, {
  validExternalId: "PETR4",
  searchQuery: "BOVA",
  arrangeOk: () => (scenario = "ok"),
  arrangeNotFound: () => (scenario = "not_found"),
  arrangeRateLimited: () => (scenario = "rate_limited"),
  arrangeProviderDown: () => (scenario = "provider_down"),
  arrangeSchemaChanged: () => (scenario = "schema_changed"),
});

describe("brapiProvider.fetchPrices", () => {
  it("treats a quote for a different symbol as not_found instead of mis-keying it", async () => {
    scenario = "ok";
    const result = await brapiProvider.fetchPrices!("VALE3", { from: "2026-01-01", to: "2026-01-01" });
    expect(result.outcome).toBe("not_found");
  });
});

describe("brapiAssetClass", () => {
  it("maps bdr, a named ETF fund, a plain fund (FII), and anything else to stocks", () => {
    expect(brapiAssetClass("bdr", "AAPL34")).toBe("bdr");
    expect(brapiAssetClass("fund", "ISHARES BOVA CI ETF")).toBe("etf");
    expect(brapiAssetClass("fund", "CSHG LOGISTICA")).toBe("fii");
    expect(brapiAssetClass(undefined, "PETROBRAS")).toBe("stocks");
  });
});
