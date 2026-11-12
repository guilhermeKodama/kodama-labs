import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { BRAPI_TOKEN: "tok en" } }));

import { brapiProvider } from "../brapi";

const RANGE = { from: "2026-01-01", to: "2026-01-01" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>();
const urlOf = (call: number) => String(fetchMock.mock.calls[call]![0]);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("brapi with a BRAPI_TOKEN", () => {
  it("appends the token (URL-encoded) with ? to a quote URL and with & to a lookup URL", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ symbol: "PETR4", regularMarketPrice: 38.2 }] }));
    await brapiProvider.fetchPrices!("PETR4", RANGE);
    expect(urlOf(0)).toBe("https://brapi.dev/api/quote/PETR4?token=tok%20en");

    fetchMock.mockResolvedValueOnce(json({ stocks: [] }));
    await brapiProvider.lookup!("petr");
    expect(urlOf(1)).toBe("https://brapi.dev/api/quote/list?search=petr&limit=8&token=tok%20en");
  });
});

describe("brapi fetchPrices body handling", () => {
  it("reports schema_changed when results is present but not an array", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: { symbol: "PETR4" } }));
    const result = await brapiProvider.fetchPrices!("PETR4", RANGE);
    expect(result).toMatchObject({ outcome: "schema_changed", status: 200, error: "results is not an array" });
  });

  it("is not_found when the body has no results key at all", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await brapiProvider.fetchPrices!("PETR4", RANGE)).toEqual({ outcome: "not_found", status: 200 });
  });

  it("is not_found when the body is JSON null", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    expect(await brapiProvider.fetchPrices!("PETR4", RANGE)).toEqual({ outcome: "not_found", status: 200 });
  });

  it("is not_found for a quote without a positive numeric price", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ symbol: "PETR4", regularMarketPrice: "38.2" }] }));
    expect((await brapiProvider.fetchPrices!("PETR4", RANGE)).outcome).toBe("not_found");
  });

  it("dates a quote without a market time today, defaults the currency to BRL and leaves asOf out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
    fetchMock.mockResolvedValueOnce(json({ results: [{ symbol: "petr4", regularMarketPrice: 38.2 }] }));
    const result = await brapiProvider.fetchPrices!("PETR4", RANGE);
    expect(result).toEqual({ outcome: "ok", status: 200, data: [{ date: "2026-11-12", close: 38.2, currency: "BRL", asOf: undefined }] });
  });

  it("upper-cases the currency and takes the date from the market time", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [{ symbol: "AAPL34", regularMarketPrice: 60, currency: "usd", regularMarketTime: "2026-10-05T17:32:00.000Z" }] }));
    const result = await brapiProvider.fetchPrices!("AAPL34", RANGE);
    expect(result).toEqual({ outcome: "ok", status: 200, data: [{ date: "2026-10-05", close: 60, currency: "USD", asOf: "2026-10-05T17:32:00.000Z" }] });
  });
});

describe("brapi lookup mapping", () => {
  it("maps list items: upper-cased symbol, name falling back to the symbol, price only when positive, class by type and name", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        stocks: [
          { stock: "petr4", name: "PETROBRAS PN", close: 38.2, type: "stock" },
          { stock: "bova11", name: "ISHARES BOVA CI", close: 0, type: "fund" },
          { stock: "hglg11", close: "n/a", type: "fund" },
          { stock: "aapl34", name: "APPLE", close: null, type: "bdr" },
          { name: "no ticker at all", close: 10 },
        ],
      }),
    );
    const result = await brapiProvider.lookup!("a");
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.data).toEqual([
      { externalId: "PETR4", symbol: "PETR4", name: "PETROBRAS PN", assetClass: "stocks", currency: "BRL", price: 38.2 },
      { externalId: "BOVA11", symbol: "BOVA11", name: "ISHARES BOVA CI", assetClass: "etf", currency: "BRL", price: null },
      { externalId: "HGLG11", symbol: "HGLG11", name: "hglg11", assetClass: "fii", currency: "BRL", price: null },
      { externalId: "AAPL34", symbol: "AAPL34", name: "APPLE", assetClass: "bdr", currency: "BRL", price: null },
    ]);
  });

  it("returns no matches when the list has no stocks key", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await brapiProvider.lookup!("zzz")).toEqual({ outcome: "ok", status: 200, data: [] });
  });

  it("passes a failed list request through untouched", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await brapiProvider.lookup!("petr")).toEqual({ outcome: "unauthorized", status: 401 });
  });
});
