import type { FetchOutcome } from "@capital/server/lib/http";
import { isoOrNull } from "../lib/time";
import type { InstrumentMatch, MarketDataProvider, PricePoint } from "../lib/provider";

/**
 * Yahoo Finance — international stocks/ETFs, plus the "<ticker>.SA" fallback
 * for B3 tickers brapi misses. Only "today" for now: the adjusted-vs-raw
 * close question for yahoo-finance2's historical endpoints hasn't been
 * verified (see the F1 plan's "Riscos abertos"), so fetchPrices always
 * returns a single point for today regardless of `range`.
 */

interface YahooQuoteResult {
  symbol?: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: Date | number | string;
}

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
}

interface YahooClient {
  quote(ticker: string): Promise<YahooQuoteResult | null | undefined>;
  search(query: string, options?: Record<string, unknown>): Promise<{ quotes?: YahooSearchQuote[] }>;
}

let client: YahooClient | null = null;

async function yahooClient(): Promise<YahooClient> {
  if (client) return client;
  // Dynamic import keeps the library out of client bundles and SSR of pages.
  const { default: YahooFinance } = await import("yahoo-finance2");
  client = new (YahooFinance as unknown as new (opts?: Record<string, unknown>) => YahooClient)({ suppressNotices: ["yahooSurvey"] });
  return client;
}

/** The yahoo-finance2 client has no abort signal; a timer just rejects first. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Yahoo Finance timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const YAHOO_TIMEOUT_MS = 8000;

async function fetchPrices(externalId: string): Promise<FetchOutcome<PricePoint[]>> {
  let yf: YahooClient;
  try {
    yf = await yahooClient();
  } catch (error) {
    console.error("[market-data] yahoo provider failed to load:", error);
    return { outcome: "provider_down", status: null, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const q = await withTimeout(yf.quote(externalId), YAHOO_TIMEOUT_MS);
    if (!q?.regularMarketPrice) return { outcome: "not_found", status: 200 };
    const asOf = isoOrNull(q.regularMarketTime);
    const point: PricePoint = { date: (asOf ?? new Date().toISOString()).slice(0, 10), close: q.regularMarketPrice, currency: (q.currency ?? "USD").toUpperCase(), asOf: asOf ?? undefined };
    return { outcome: "ok", status: 200, data: [point] };
  } catch (error) {
    console.error(`[market-data] yahoo quote failed for ${externalId}:`, error);
    return { outcome: "provider_down", status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function lookup(query: string): Promise<FetchOutcome<InstrumentMatch[]>> {
  let yf: YahooClient;
  try {
    yf = await yahooClient();
  } catch (error) {
    return { outcome: "provider_down", status: null, error: error instanceof Error ? error.message : String(error) };
  }
  let found: YahooSearchQuote[];
  try {
    found = (await withTimeout(yf.search(query, { quotesCount: 6, newsCount: 0 }), YAHOO_TIMEOUT_MS)).quotes ?? [];
  } catch (error) {
    return { outcome: "provider_down", status: null, error: error instanceof Error ? error.message : String(error) };
  }
  const picked = found
    .filter((r): r is YahooSearchQuote & { symbol: string } => !!r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF"))
    // B3 tickers come from brapi, not Yahoo's own search.
    .filter((r) => !r.symbol.toUpperCase().endsWith(".SA"))
    .slice(0, 4);
  const matches = await Promise.all(
    picked.map(async (r): Promise<InstrumentMatch> => {
      const symbol = r.symbol.toUpperCase();
      const priced = await fetchPrices(symbol);
      const point = priced.outcome === "ok" ? priced.data[0] : undefined;
      return {
        externalId: symbol,
        symbol,
        name: r.longname ?? r.shortname ?? symbol,
        assetClass: r.quoteType === "ETF" ? "international_etf" : "international_stocks",
        currency: point?.currency ?? "USD",
        price: point?.close ?? null,
      };
    }),
  );
  return { outcome: "ok", status: 200, data: matches };
}

export const yahooProvider: MarketDataProvider = {
  id: "yahoo",
  capabilities: ["prices", "lookup"],
  markets: ["stocks", "fii", "bdr", "etf", "international_stocks", "international_etf"],
  fetchPrices,
  lookup,
};
