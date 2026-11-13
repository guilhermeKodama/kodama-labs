import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { brapiAssetClass, fetchQuotes, fetchQuotesDetailed, quoteSourceFor, searchAssets } from "../quotes";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function defaultFetchImpl(input: string | URL | Request): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://brapi.dev/api/quote/list")) {
    return json({
      stocks: [
        { stock: "BOVA11", name: "ISHARES BOVA CI", close: 128.4, type: "fund" },
        { stock: "BOVV11", name: "IT NOW IBOVESPA", close: 120.1, type: "fund" },
        { stock: "HGLG11", name: "CSHG LOGISTICA", close: 158.2, type: "fund" },
      ],
    });
  }
  if (url.startsWith("https://brapi.dev/api/quote/")) {
    // Only PETR4 is in this fixture. Anything else is not_found.
    return json({ results: [{ symbol: "PETR4", regularMarketPrice: 38.2, currency: "BRL", regularMarketTime: "2026-10-05T17:32:00.000Z" }] });
  }
  if (url.startsWith("https://api.coingecko.com/api/v3/simple/price")) {
    expect(url).toContain("vs_currencies=brl");
    return json({ bitcoin: { brl: 342100, last_updated_at: 1791222720 } });
  }
  if (url.startsWith("https://www.alphavantage.co/query")) {
    const symbol = new URL(url).searchParams.get("symbol");
    if (symbol === "VOO") return json({ "Global Quote": { "05. price": "500.5000", "07. latest trading day": "2026-10-05" } });
    return json({ "Global Quote": {} });
  }
  return json({}, 404);
}

const fetchMock = vi.fn(defaultFetchImpl);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // A test that overrides the implementation (not just mockImplementationOnce)
  // must not leak into the next one.
  fetchMock.mockImplementation(defaultFetchImpl);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quoteSourceFor", () => {
  it("follows the holding's asset class, else the ticker's shape", () => {
    expect(quoteSourceFor("BTC")).toBe("coingecko");
    expect(quoteSourceFor("PETR4")).toBe("brapi");
    expect(quoteSourceFor("VOO")).toBe("alpha_vantage");
    expect(quoteSourceFor("IVVB11", "etf")).toBe("brapi");
    expect(quoteSourceFor("AAPL", "international_stocks")).toBe("alpha_vantage");
    expect(quoteSourceFor("CDB", "fixed_income")).toBeNull();
    expect(quoteSourceFor("SHIB", "crypto")).toBeNull();
  });
});

describe("fetchQuotes", () => {
  it("prices B3, international and crypto tickers", async () => {
    const quotes = await fetchQuotes(
      [{ ticker: "petr4" }, { ticker: "KNRI11", assetClass: "fii" }, { ticker: "VOO" }, { ticker: "BTC", currency: "BRL" }, { ticker: "NOPE3" }],
      { cryptoCurrency: "BRL" }
    );
    expect(quotes.PETR4).toEqual({ ticker: "PETR4", price: 38.2, currency: "BRL", source: "brapi", asOf: "2026-10-05T17:32:00.000Z" });
    expect(quotes.KNRI11).toBeUndefined();
    expect(quotes.VOO).toMatchObject({ price: 500.5, currency: "USD", source: "alpha_vantage", asOf: null });
    expect(quotes.BTC).toMatchObject({ price: 342100, currency: "BRL", source: "coingecko" });
    expect(quotes.BTC.asOf).not.toBeNull();
    expect(quotes.NOPE3).toBeUndefined();
  });

  it("returns what it got when a source is down for every attempt (retries do not mask a sustained outage)", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://brapi.dev/api/quote/")) throw new Error("network down");
      if (url.startsWith("https://www.alphavantage.co/query")) return json({ "Global Quote": { "05. price": "500.5000", "07. latest trading day": "2026-10-05" } });
      return json({}, 404);
    });
    const quotes = await fetchQuotes([{ ticker: "PETR4" }, { ticker: "VOO" }]);
    expect(quotes.PETR4).toBeUndefined();
    expect(quotes.VOO).toMatchObject({ price: 500.5, source: "alpha_vantage" });
  });

  it("retries a one-off failure and still prices the ticker", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network blip");
    });
    const quotes = await fetchQuotes([{ ticker: "PETR4" }]);
    expect(quotes.PETR4).toMatchObject({ price: 38.2, source: "brapi" });
  });
});

describe("fetchQuotesDetailed", () => {
  it("reports why a ticker has no price: no source, not found, and a down provider", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://brapi.dev/api/quote/")) throw new Error("network down");
      return json({}, 404);
    });
    const { quotes, attempts } = await fetchQuotesDetailed([{ ticker: "CDB", assetClass: "fixed_income" }, { ticker: "PETR4" }]);
    expect(quotes).toEqual({});
    expect(attempts).toEqual(
      expect.arrayContaining([
        { ticker: "CDB", source: null, outcome: "no_source" },
        expect.objectContaining({ ticker: "PETR4", source: "brapi", outcome: "provider_down" }),
      ]),
    );
  });
});

describe("searchAssets", () => {
  it("merges B3, international and crypto results, exact tickers first", async () => {
    const results = await searchAssets("bova", { cryptoCurrency: "BRL" });
    expect(results.map((r) => [r.ticker, r.assetClass, r.price])).toEqual([
      ["BOVA11", "etf", 128.4],
      ["BOVV11", "etf", 120.1],
      ["HGLG11", "fii", 158.2],
    ]);
  });

  it("finds the supported coins by symbol or name, priced in the requested currency", async () => {
    const results = await searchAssets("bitcoin", { cryptoCurrency: "BRL" });
    expect(results.find((r) => r.ticker === "BTC")).toEqual({ ticker: "BTC", name: "Bitcoin", assetClass: "crypto", currency: "BRL", price: 342100, source: "coingecko" });
  });

  it("needs two characters", async () => {
    expect(await searchAssets("b")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("brapiAssetClass", () => {
  it("tells ETFs from FIIs by name", () => {
    expect(brapiAssetClass("stock", "PETROBRAS PN")).toBe("stocks");
    expect(brapiAssetClass("bdr", "APPLE DRN")).toBe("bdr");
    expect(brapiAssetClass("fund", "ISHARES BOVA CI")).toBe("etf");
    expect(brapiAssetClass("fund", "KINEA RENDA IMOBILIARIA")).toBe("fii");
  });
});
