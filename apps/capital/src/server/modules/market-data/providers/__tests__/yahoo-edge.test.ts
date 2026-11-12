import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(),
  search: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = yahoo.quote;
    search = yahoo.search;
  },
}));

import { yahooProvider } from "../yahoo";

const RANGE = { from: "2026-01-01", to: "2026-01-01" };

beforeEach(() => {
  yahoo.quote.mockReset();
  yahoo.search.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("yahoo fetchPrices", () => {
  it("dates a quote without a market time today, defaults the currency to USD and leaves asOf out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
    yahoo.quote.mockResolvedValueOnce({ symbol: "VOO", regularMarketPrice: 500.5 });
    const result = await yahooProvider.fetchPrices!("VOO", RANGE);
    expect(result).toEqual({ outcome: "ok", status: 200, data: [{ date: "2026-11-12", close: 500.5, currency: "USD", asOf: undefined }] });
  });

  it("upper-cases the currency and dates the point by the market time", async () => {
    yahoo.quote.mockResolvedValueOnce({ symbol: "SAP", regularMarketPrice: 180, currency: "eur", regularMarketTime: Date.parse("2026-10-05T17:32:00Z") / 1000 });
    const result = await yahooProvider.fetchPrices!("SAP", RANGE);
    expect(result).toEqual({ outcome: "ok", status: 200, data: [{ date: "2026-10-05", close: 180, currency: "EUR", asOf: "2026-10-05T17:32:00.000Z" }] });
  });

  it("is not_found for a zero price", async () => {
    yahoo.quote.mockResolvedValueOnce({ symbol: "VOO", regularMarketPrice: 0 });
    expect(await yahooProvider.fetchPrices!("VOO", RANGE)).toEqual({ outcome: "not_found", status: 200 });
  });

  it("stringifies a non-Error rejection into provider_down", async () => {
    yahoo.quote.mockRejectedValueOnce("socket hang up");
    expect(await yahooProvider.fetchPrices!("VOO", RANGE)).toEqual({ outcome: "provider_down", status: null, error: "socket hang up" });
  });

  it("gives up with provider_down when the client takes longer than the timeout", async () => {
    vi.useFakeTimers();
    yahoo.quote.mockImplementationOnce(() => new Promise(() => {}));
    const pending = yahooProvider.fetchPrices!("VOO", RANGE);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual({ outcome: "provider_down", status: null, error: "Yahoo Finance timed out after 8000ms" });
  });
});

describe("yahoo lookup", () => {
  it("keeps equities and ETFs only, caps at four, names them longname then shortname then symbol, and prices each one", async () => {
    yahoo.search.mockResolvedValueOnce({
      quotes: [
        { symbol: "aapl", longname: "Apple Inc.", shortname: "Apple", quoteType: "EQUITY" },
        { symbol: "voo", shortname: "Vanguard S&P 500", quoteType: "ETF" },
        { symbol: "msft", quoteType: "EQUITY" },
        { symbol: "btc-usd", shortname: "Bitcoin USD", quoteType: "CRYPTOCURRENCY" },
        { shortname: "no symbol", quoteType: "EQUITY" },
        { symbol: "goog", shortname: "Alphabet", quoteType: "EQUITY" },
        { symbol: "amzn", shortname: "Amazon", quoteType: "EQUITY" },
      ],
    });
    yahoo.quote.mockImplementation(async (ticker: string) => ({ symbol: ticker, regularMarketPrice: ticker === "VOO" ? 500 : 100, currency: "usd" }));
    const result = await yahooProvider.lookup!("a");
    expect(yahoo.search).toHaveBeenCalledWith("a", { quotesCount: 6, newsCount: 0 });
    expect(result).toEqual({
      outcome: "ok",
      status: 200,
      data: [
        { externalId: "AAPL", symbol: "AAPL", name: "Apple Inc.", assetClass: "international_stocks", currency: "USD", price: 100 },
        { externalId: "VOO", symbol: "VOO", name: "Vanguard S&P 500", assetClass: "international_etf", currency: "USD", price: 500 },
        { externalId: "MSFT", symbol: "MSFT", name: "MSFT", assetClass: "international_stocks", currency: "USD", price: 100 },
        { externalId: "GOOG", symbol: "GOOG", name: "Alphabet", assetClass: "international_stocks", currency: "USD", price: 100 },
      ],
    });
  });

  it("still lists a match whose quote cannot be fetched, unpriced and in USD", async () => {
    yahoo.search.mockResolvedValueOnce({ quotes: [{ symbol: "VOO", shortname: "Vanguard", quoteType: "ETF" }] });
    yahoo.quote.mockRejectedValueOnce(new Error("quote down"));
    const result = await yahooProvider.lookup!("voo");
    expect(result).toEqual({
      outcome: "ok",
      status: 200,
      data: [{ externalId: "VOO", symbol: "VOO", name: "Vanguard", assetClass: "international_etf", currency: "USD", price: null }],
    });
  });

  it("returns no matches when the search answers without a quotes list", async () => {
    yahoo.search.mockResolvedValueOnce({});
    expect(await yahooProvider.lookup!("zzz")).toEqual({ outcome: "ok", status: 200, data: [] });
  });

  it("reports provider_down with the message of an Error, or the text of anything else, when the search fails", async () => {
    yahoo.search.mockRejectedValueOnce(new Error("search down"));
    expect(await yahooProvider.lookup!("voo")).toEqual({ outcome: "provider_down", status: null, error: "search down" });
    yahoo.search.mockRejectedValueOnce("rate limit");
    expect(await yahooProvider.lookup!("voo")).toEqual({ outcome: "provider_down", status: null, error: "rate limit" });
  });
});

describe("yahoo client loading", () => {
  afterEach(() => {
    vi.doUnmock("yahoo-finance2");
    vi.resetModules();
  });

  async function providerWithBrokenLibrary(thrown: unknown) {
    vi.resetModules();
    vi.doMock("yahoo-finance2", () => ({
      default: class {
        constructor() {
          throw thrown;
        }
      },
    }));
    return (await import("../yahoo")).yahooProvider;
  }

  it("fetchPrices answers provider_down with the Error message when the library cannot load", async () => {
    const provider = await providerWithBrokenLibrary(new Error("cannot load yahoo"));
    expect(await provider.fetchPrices!("VOO", RANGE)).toEqual({ outcome: "provider_down", status: null, error: "cannot load yahoo" });
    expect(console.error).toHaveBeenCalledWith("[market-data] yahoo provider failed to load:", expect.any(Error));
  });

  it("fetchPrices stringifies a non-Error load failure", async () => {
    const provider = await providerWithBrokenLibrary("boom");
    expect(await provider.fetchPrices!("VOO", RANGE)).toEqual({ outcome: "provider_down", status: null, error: "boom" });
  });

  it("lookup answers provider_down when the library cannot load", async () => {
    const provider = await providerWithBrokenLibrary(new Error("cannot load yahoo"));
    expect(await provider.lookup!("voo")).toEqual({ outcome: "provider_down", status: null, error: "cannot load yahoo" });
  });

  it("lookup stringifies a non-Error load failure", async () => {
    const provider = await providerWithBrokenLibrary("boom");
    expect(await provider.lookup!("voo")).toEqual({ outcome: "provider_down", status: null, error: "boom" });
  });
});
