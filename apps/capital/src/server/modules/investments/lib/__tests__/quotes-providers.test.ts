import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchOutcome } from "@capital/server/lib/http";
import type { InstrumentMatch, MarketDataProvider, PricePoint } from "@capital/server/modules/market-data/lib/provider";

const registry = vi.hoisted(() => ({ activeProviders: vi.fn<() => MarketDataProvider[]>() }));
vi.mock("@capital/server/modules/market-data/lib/registry", () => ({ activeProviders: registry.activeProviders }));

import {
  fetchBrazilianQuotes,
  fetchCryptoQuotes,
  fetchQuotes,
  fetchQuotesDetailed,
  fetchYahooQuotes,
  holdingPriceStatus,
  quoteRequestKey,
  searchAssets,
  sessionsMissed,
} from "../quotes";

type Prices = (externalId: string) => FetchOutcome<PricePoint[]>;

const point = (close: number, patch: Partial<PricePoint> = {}): PricePoint => ({ date: "2026-11-10", close, currency: "BRL", ...patch });
const ok = (...points: PricePoint[]): FetchOutcome<PricePoint[]> => ({ outcome: "ok", status: 200, data: points });

function provider(id: string, prices?: Prices, lookup?: () => FetchOutcome<InstrumentMatch[]>): MarketDataProvider {
  return {
    id,
    capabilities: ["prices", "lookup"],
    markets: ["stocks", "crypto", "international_stocks"],
    ...(prices && { fetchPrices: vi.fn(async (externalId: string) => prices(externalId)) }),
    ...(lookup && { lookup: vi.fn(async () => lookup()) }),
  };
}

beforeEach(() => {
  registry.activeProviders.mockReset();
  registry.activeProviders.mockReturnValue([]);
});

describe("quoteRequestKey", () => {
  it("keys crypto by upper-cased ticker and currency (USD by default) and everything else by ticker", () => {
    expect(quoteRequestKey({ ticker: "btc", assetClass: "crypto", currency: "brl" })).toBe("BTC:BRL");
    expect(quoteRequestKey({ ticker: "btc", assetClass: "crypto" })).toBe("BTC:USD");
    expect(quoteRequestKey({ ticker: "petr4", assetClass: "stocks", currency: "BRL" })).toBe("PETR4");
    expect(quoteRequestKey({ ticker: "voo" })).toBe("VOO");
  });
});

describe("holdingPriceStatus", () => {
  // Tuesday 2026-11-10, 19:30 in São Paulo: the day's B3 close is ready.
  const now = new Date("2026-11-10T22:30:00Z");
  const priced = { ticker: "PETR4", assetClass: "stocks" as const, currentPrice: 38, lastPriceUpdate: new Date("2026-11-10T21:00:00Z") };

  it("is no_ticker without a ticker and unsupported for a class no source prices", () => {
    expect(holdingPriceStatus({ ...priced, ticker: null }, now)).toBe("no_ticker");
    expect(holdingPriceStatus({ ...priced, ticker: "CDB", assetClass: "fixed_income" }, now)).toBe("unsupported");
    expect(holdingPriceStatus({ ...priced, ticker: "SHIB", assetClass: "crypto" }, now)).toBe("unsupported");
  });

  it("is unpriced until it has both a price and the time of that price", () => {
    expect(holdingPriceStatus({ ...priced, currentPrice: null }, now)).toBe("unpriced");
    expect(holdingPriceStatus({ ...priced, lastPriceUpdate: null }, now)).toBe("unpriced");
  });

  it("is fresh up to one missed close and stale from two", () => {
    expect(holdingPriceStatus(priced, now)).toBe("fresh");
    expect(holdingPriceStatus({ ...priced, lastPriceUpdate: new Date("2026-11-09T21:00:00Z") }, now)).toBe("fresh");
    // Friday's close: Monday and Tuesday are missed.
    expect(holdingPriceStatus({ ...priced, lastPriceUpdate: new Date("2026-11-06T21:00:00Z") }, now)).toBe("stale");
  });
});

describe("sessionsMissed", () => {
  it("counts the closes since the price, and is zero for a class with no market", () => {
    const now = new Date("2026-11-10T22:30:00Z");
    expect(sessionsMissed("PETR4", "stocks", new Date("2026-11-06T21:00:00Z"), now)).toBe(2);
    expect(sessionsMissed("CDB", "fixed_income", new Date("2020-01-01T00:00:00Z"), now)).toBe(0);
  });
});

describe("when the sources are turned off in the registry", () => {
  it("answers provider_down, naming the disabled source, for crypto, B3 and international tickers", async () => {
    const { quotes, attempts } = await fetchQuotesDetailed([{ ticker: "BTC", assetClass: "crypto" }, { ticker: "PETR4" }, { ticker: "VOO" }]);
    expect(quotes).toEqual({});
    expect(attempts).toEqual(
      expect.arrayContaining([
        { ticker: "BTC", source: "coingecko", outcome: "provider_down", error: "coingecko disabled via MARKET_DATA_DISABLED" },
        { ticker: "VOO", source: "yahoo", outcome: "provider_down", error: "yahoo disabled via MARKET_DATA_DISABLED" },
        // brapi was off too, so the .SA retry on Yahoo is what speaks for PETR4.
        { ticker: "PETR4", source: "yahoo", outcome: "provider_down", error: "yahoo disabled via MARKET_DATA_DISABLED" },
      ]),
    );
    expect(attempts).toHaveLength(3);
  });

  it("reports brapi as disabled when Yahoo is the only source left, then lets Yahoo's .SA answer", async () => {
    const yahoo = provider("yahoo", (externalId) => (externalId === "PETR4.SA" ? ok(point(38.2, { asOf: "2026-11-10T20:00:00.000Z" })) : { outcome: "not_found", status: 404 }));
    registry.activeProviders.mockReturnValue([yahoo]);
    const { quotes, attempts } = await fetchQuotesDetailed([{ ticker: "PETR4" }]);
    expect(quotes.PETR4).toEqual({ ticker: "PETR4", price: 38.2, currency: "BRL", source: "yahoo", asOf: "2026-11-10T20:00:00.000Z" });
    expect(attempts).toEqual([{ ticker: "PETR4", source: "yahoo", outcome: "ok", error: undefined }]);
  });

  it("returns no search matches from a disabled brapi or Yahoo, only the supported coins unpriced", async () => {
    const results = await searchAssets("doge");
    expect(results).toEqual([{ ticker: "DOGE", name: "Dogecoin", assetClass: "crypto", currency: "USD", price: null, source: "coingecko" }]);
  });
});

describe("a source answering badly", () => {
  it("carries the provider's error text, or none, onto the attempt for crypto", async () => {
    const down = provider("coingecko", () => ({ outcome: "provider_down", status: null, error: "socket closed" }));
    registry.activeProviders.mockReturnValue([down]);
    const withError = await fetchQuotesDetailed([{ ticker: "BTC", assetClass: "crypto" }]);
    expect(withError.attempts).toEqual([{ ticker: "BTC", source: "coingecko", outcome: "provider_down", error: "socket closed" }]);

    const limited = provider("coingecko", () => ({ outcome: "rate_limited", status: 429, retryAfterMs: 1000 }));
    registry.activeProviders.mockReturnValue([limited]);
    const withoutError = await fetchQuotesDetailed([{ ticker: "BTC", assetClass: "crypto" }]);
    expect(withoutError.attempts).toEqual([{ ticker: "BTC", source: "coingecko", outcome: "rate_limited", error: undefined }]);
  });

  it("is not_found when an ok answer has no points, for crypto, brapi and Yahoo alike", async () => {
    const empty: Prices = () => ok();
    registry.activeProviders.mockReturnValue([provider("coingecko", empty), provider("brapi", empty), provider("yahoo", empty)]);
    const { quotes, attempts } = await fetchQuotesDetailed([{ ticker: "BTC", assetClass: "crypto" }, { ticker: "PETR4" }, { ticker: "VOO" }]);
    expect(quotes).toEqual({});
    expect(attempts).toEqual(
      expect.arrayContaining([
        { ticker: "BTC", source: "coingecko", outcome: "not_found", error: undefined },
        { ticker: "VOO", source: "yahoo", outcome: "not_found", error: undefined },
        { ticker: "PETR4", source: "yahoo", outcome: "not_found", error: undefined },
      ]),
    );
  });

  it("carries a down provider's error for brapi and Yahoo", async () => {
    registry.activeProviders.mockReturnValue([
      provider("brapi", () => ({ outcome: "provider_down", status: 500, error: "HTTP 500" })),
      provider("yahoo", () => ({ outcome: "provider_down", status: null, error: "timeout" })),
    ]);
    const { attempts } = await fetchQuotesDetailed([{ ticker: "PETR4" }, { ticker: "VOO" }]);
    expect(attempts).toEqual(
      expect.arrayContaining([
        { ticker: "VOO", source: "yahoo", outcome: "provider_down", error: "timeout" },
        { ticker: "PETR4", source: "yahoo", outcome: "provider_down", error: "timeout" },
      ]),
    );
  });

  it("leaves asOf null when the point carries no instant", async () => {
    registry.activeProviders.mockReturnValue([provider("brapi", () => ok(point(38.2))), provider("coingecko", () => ok(point(65000, { currency: "USD" })))]);
    const quotes = await fetchQuotes([{ ticker: "PETR4" }, { ticker: "BTC", assetClass: "crypto" }]);
    expect(quotes.PETR4).toMatchObject({ source: "brapi", asOf: null });
    expect(quotes.BTC).toMatchObject({ source: "coingecko", asOf: null, currency: "USD" });
  });
});

describe("batching", () => {
  it("skips blank tickers and prices crypto in the request's currency, else the option's, else USD", async () => {
    const coingecko = provider("coingecko", (externalId) => ok(point(1, { currency: externalId.split(":")[1]!.toUpperCase() })));
    registry.activeProviders.mockReturnValue([coingecko]);
    const quotes = await fetchQuotes(
      [{ ticker: "  " }, { ticker: "btc", assetClass: "crypto", currency: "brl" }, { ticker: "eth", assetClass: "crypto" }, { ticker: "sol", assetClass: "crypto", currency: null }],
      { cryptoCurrency: "eur" },
    );
    expect(Object.keys(quotes).sort()).toEqual(["BTC", "ETH", "SOL"]);
    expect(quotes.BTC!.currency).toBe("BRL");
    expect(quotes.ETH!.currency).toBe("EUR");
    expect(quotes.SOL!.currency).toBe("EUR");
    expect(coingecko.fetchPrices).toHaveBeenCalledWith("bitcoin:brl", expect.anything());
    expect(coingecko.fetchPrices).toHaveBeenCalledWith("ethereum:eur", expect.anything());

    const defaults = await fetchQuotes([{ ticker: "btc", assetClass: "crypto" }]);
    expect(defaults.BTC!.currency).toBe("USD");
    expect(coingecko.fetchPrices).toHaveBeenLastCalledWith("bitcoin:usd", expect.anything());
  });

  it("asks a provider once per distinct ticker however many times it is requested", async () => {
    const brapi = provider("brapi", () => ok(point(38.2)));
    registry.activeProviders.mockReturnValue([brapi]);
    await fetchQuotes([{ ticker: "petr4" }, { ticker: "PETR4" }, { ticker: " petr4 " }]);
    expect(brapi.fetchPrices).toHaveBeenCalledTimes(1);
  });

  it("returns empty results for no tickers and for tickers nothing prices, without calling a provider", async () => {
    const coingecko = provider("coingecko", () => ok(point(1)));
    const brapi = provider("brapi", () => ok(point(1)));
    const yahoo = provider("yahoo", () => ok(point(1)));
    registry.activeProviders.mockReturnValue([coingecko, brapi, yahoo]);
    expect(await fetchBrazilianQuotes([])).toEqual({});
    expect(await fetchYahooQuotes([])).toEqual({});
    expect(await fetchCryptoQuotes(["SHIB"])).toEqual({});
    expect(await fetchQuotes([])).toEqual({});
    expect(coingecko.fetchPrices).not.toHaveBeenCalled();
    expect(brapi.fetchPrices).not.toHaveBeenCalled();
    expect(yahoo.fetchPrices).not.toHaveBeenCalled();
  });
});

describe("the exported single-source fetchers", () => {
  it("fetchBrazilianQuotes prices each distinct upper-cased ticker through brapi", async () => {
    const brapi = provider("brapi", (id) => ok(point(id === "PETR4" ? 38.2 : 20)));
    registry.activeProviders.mockReturnValue([brapi]);
    const quotes = await fetchBrazilianQuotes(["petr4", "vale3", "PETR4"], "ignored-token");
    expect(Object.keys(quotes).sort()).toEqual(["PETR4", "VALE3"]);
    expect(quotes.PETR4).toMatchObject({ price: 38.2, source: "brapi" });
    expect(brapi.fetchPrices).toHaveBeenCalledTimes(2);
  });

  it("fetchYahooQuotes prices through Yahoo and leaves out what it cannot find", async () => {
    const yahoo = provider("yahoo", (id) => (id === "VOO" ? ok(point(500.5, { currency: "USD" })) : { outcome: "not_found", status: 200 }));
    registry.activeProviders.mockReturnValue([yahoo]);
    expect(await fetchYahooQuotes(["voo", "nope"])).toEqual({ VOO: { ticker: "VOO", price: 500.5, currency: "USD", source: "yahoo", asOf: null } });
  });

  it("fetchCryptoQuotes prices supported symbols in the currency given and drops unsupported ones", async () => {
    const coingecko = provider("coingecko", () => ok(point(342100, { currency: "BRL" })));
    registry.activeProviders.mockReturnValue([coingecko]);
    const quotes = await fetchCryptoQuotes(["btc", "NOTACOIN"], "brl");
    expect(Object.keys(quotes)).toEqual(["BTC"]);
    expect(coingecko.fetchPrices).toHaveBeenCalledWith("bitcoin:brl", expect.anything());
  });
});

describe("searchAssets with sources", () => {
  const match = (symbol: string, patch: Partial<InstrumentMatch> = {}): InstrumentMatch => ({
    externalId: symbol,
    symbol,
    name: `${symbol} name`,
    assetClass: "stocks",
    currency: "BRL",
    ...patch,
  });

  it("maps matches without a price to null, and ignores a source whose lookup is not ok", async () => {
    const brapi = provider("brapi", undefined, () => ({ outcome: "ok", status: 200, data: [match("PETR4"), match("PETZ3", { price: 12 })] }));
    const yahoo = provider("yahoo", undefined, () => ({ outcome: "provider_down", status: null, error: "down" }));
    registry.activeProviders.mockReturnValue([brapi, yahoo]);
    const results = await searchAssets("pet");
    expect(results).toEqual([
      { ticker: "PETR4", name: "PETR4 name", assetClass: "stocks", currency: "BRL", price: null, source: "brapi" },
      { ticker: "PETZ3", name: "PETZ3 name", assetClass: "stocks", currency: "BRL", price: 12, source: "brapi" },
    ]);
  });

  it("ignores a brapi lookup that is not ok while the other sources answer", async () => {
    const brapi = provider("brapi", undefined, () => ({ outcome: "rate_limited", status: 429, retryAfterMs: null }));
    const yahoo = provider("yahoo", undefined, () => ({ outcome: "ok", status: 200, data: [match("VOO", { assetClass: "international_etf", currency: "USD", price: 500 })] }));
    registry.activeProviders.mockReturnValue([brapi, yahoo]);
    const results = await searchAssets("voo");
    expect(results.map((r) => [r.ticker, r.source])).toEqual([["VOO", "yahoo"]]);
  });

  it("maps Yahoo matches, skips a provider with no lookup and puts the exact ticker first", async () => {
    const brapi = provider("brapi", () => ok());
    const yahoo = provider("yahoo", undefined, () => ({
      outcome: "ok",
      status: 200,
      data: [match("VOOG", { assetClass: "international_etf", currency: "USD" }), match("VOO", { assetClass: "international_etf", currency: "USD", price: 500 })],
    }));
    registry.activeProviders.mockReturnValue([brapi, yahoo]);
    const results = await searchAssets(" voo ");
    expect(results.map((r) => [r.ticker, r.source, r.price])).toEqual([
      ["VOO", "yahoo", 500],
      ["VOOG", "yahoo", null],
    ]);
  });

  it("de-duplicates by ticker across sources and caps at the limit (8 by default)", async () => {
    const same = [match("BTC", { assetClass: "crypto", currency: "USD" })];
    const brapi = provider("brapi", undefined, () => ({ outcome: "ok", status: 200, data: same }));
    registry.activeProviders.mockReturnValue([brapi]);
    // "BTC" is a supported coin as well: the B3-side row wins, the crypto one is dropped.
    const merged = await searchAssets("btc");
    expect(merged.filter((r) => r.ticker === "BTC")).toEqual([{ ticker: "BTC", name: "BTC name", assetClass: "crypto", currency: "USD", price: null, source: "brapi" }]);

    registry.activeProviders.mockReturnValue([]);
    const many = await searchAssets("co");
    expect(many.length).toBeLessThanOrEqual(8);
    expect(await searchAssets("co", { limit: 1 })).toHaveLength(1);
  });

  it("prices coin results in the currency asked for", async () => {
    const coingecko = provider("coingecko", () => ok(point(342100, { currency: "BRL" })));
    registry.activeProviders.mockReturnValue([coingecko]);
    const results = await searchAssets("bitcoin", { cryptoCurrency: "brl" });
    expect(results).toEqual([{ ticker: "BTC", name: "Bitcoin", assetClass: "crypto", currency: "BRL", price: 342100, source: "coingecko" }]);
  });
});
