import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(async (ticker: string) => {
    const prices: Record<string, { regularMarketPrice: number; currency: string }> = {
      VOO: { regularMarketPrice: 500.5, currency: "USD" },
      "KNRI11.SA": { regularMarketPrice: 141.6, currency: "BRL" },
      QQQM: { regularMarketPrice: 210, currency: "USD" },
    };
    return prices[ticker] ? { ...prices[ticker], regularMarketTime: new Date("2026-10-05T17:32:00Z") } : undefined;
  }),
  search: vi.fn(async () => ({
    quotes: [
      { symbol: "QQQM", shortname: "Invesco NASDAQ 100 ETF", quoteType: "ETF" },
      { symbol: "QQQ.SA", shortname: "Something on B3", quoteType: "EQUITY" },
      { symbol: "QQQX", shortname: "A fund", quoteType: "MUTUALFUND" },
    ],
  })),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = yahoo.quote;
    search = yahoo.search;
  },
}));

import { brapiAssetClass, fetchQuotes, quoteSourceFor, searchAssets } from "../quotes";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
    // KNRI11 is missing on brapi: Yahoo ".SA" fills it in.
    return json({ results: [{ symbol: "PETR4", regularMarketPrice: 38.2, currency: "BRL", regularMarketTime: "2026-10-05T17:32:00.000Z" }] });
  }
  if (url.startsWith("https://api.coingecko.com/api/v3/simple/price")) {
    expect(url).toContain("vs_currencies=brl");
    return json({ bitcoin: { brl: 342100, last_updated_at: 1791222720 } });
  }
  return json({}, 404);
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quoteSourceFor", () => {
  it("follows the holding's asset class, else the ticker's shape", () => {
    expect(quoteSourceFor("BTC")).toBe("coingecko");
    expect(quoteSourceFor("PETR4")).toBe("brapi");
    expect(quoteSourceFor("VOO")).toBe("yahoo");
    expect(quoteSourceFor("IVVB11", "etf")).toBe("brapi");
    expect(quoteSourceFor("AAPL", "international_stocks")).toBe("yahoo");
    expect(quoteSourceFor("CDB", "fixed_income")).toBeNull();
    expect(quoteSourceFor("SHIB", "crypto")).toBeNull();
  });
});

describe("fetchQuotes", () => {
  it("prices B3, international and crypto tickers, with Yahoo .SA as the B3 fallback", async () => {
    const quotes = await fetchQuotes(
      [{ ticker: "petr4" }, { ticker: "KNRI11", assetClass: "fii" }, { ticker: "VOO" }, { ticker: "BTC", currency: "BRL" }, { ticker: "NOPE3" }],
      { cryptoCurrency: "BRL" }
    );
    expect(quotes.PETR4).toEqual({ ticker: "PETR4", price: 38.2, currency: "BRL", source: "brapi", asOf: "2026-10-05T17:32:00.000Z" });
    expect(quotes.KNRI11).toMatchObject({ ticker: "KNRI11", price: 141.6, currency: "BRL", source: "yahoo" });
    expect(quotes.VOO).toMatchObject({ price: 500.5, currency: "USD", source: "yahoo", asOf: "2026-10-05T17:32:00.000Z" });
    expect(quotes.BTC).toMatchObject({ price: 342100, currency: "BRL", source: "coingecko" });
    expect(quotes.BTC.asOf).not.toBeNull();
    expect(quotes.NOPE3).toBeUndefined();
  });

  it("returns what it got when a source fails", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const quotes = await fetchQuotes([{ ticker: "PETR4" }, { ticker: "VOO" }]);
    expect(quotes.PETR4).toBeUndefined();
    expect(quotes.VOO).toMatchObject({ price: 500.5 });
  });
});

describe("searchAssets", () => {
  it("merges B3, international and crypto results, exact tickers first", async () => {
    const results = await searchAssets("bova", { cryptoCurrency: "BRL" });
    expect(results.map((r) => [r.ticker, r.assetClass, r.price])).toEqual([
      ["BOVA11", "etf", 128.4],
      ["BOVV11", "etf", 120.1],
      ["HGLG11", "fii", 158.2],
      ["QQQM", "international_etf", 210],
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
