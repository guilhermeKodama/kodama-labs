import type { AssetClass } from "@/generated/prisma";

/**
 * Market data fetchers shared by the price-refresh cron (services/update-prices.ts),
 * GET /v2/quotes and GET /v2/assets/search:
 *
 * - CoinGecko for crypto (only the symbols in CRYPTO_SYMBOL_TO_COINGECKO_ID,
 *   the ones the cron can keep up to date);
 * - brapi.dev for B3 tickers (stocks, FIIs, ETFs, BDRs), with Yahoo's
 *   "<ticker>.SA" as fallback;
 * - Yahoo Finance for everything else (international stocks and ETFs).
 *
 * Every fetcher swallows network and API errors and returns what it got:
 * a missing ticker means "no quote", never an exception.
 */

export type QuoteSource = "coingecko" | "brapi" | "yahoo";

export interface Quote {
  ticker: string;
  price: number;
  currency: string;
  source: QuoteSource;
  /** When the market price was set (ISO), when the source says. */
  asOf: string | null;
}

export interface QuoteRequest {
  ticker: string;
  /** Asset class of the user's holding with this ticker, when there is one. */
  assetClass?: AssetClass | null;
  /** Currency to price crypto in (the holding's, else the user's base currency). */
  currency?: string | null;
}

export interface AssetSearchResult {
  ticker: string;
  name: string;
  /** Best guess for a new holding; the user can change it. */
  assetClass: AssetClass;
  currency: string;
  price: number | null;
  source: QuoteSource;
}

const REQUEST_TIMEOUT_MS = 5000;

const timeout = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined);

async function getJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: timeout() });
    if (!res.ok) {
      console.error(`[Quotes] ${label} error: ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[Quotes] ${label} fetch failed:`, error);
    return null;
  }
}

const isoOrNull = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export const CRYPTO_SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  ADA: "cardano",
  SOL: "solana",
  DOT: "polkadot",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  MATIC: "matic-network",
  LINK: "chainlink",
  XRP: "ripple",
  USDT: "tether",
  USDC: "usd-coin",
  UNI: "uniswap",
  AAVE: "aave",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
};

/** Display names of the supported coins, for the asset search. */
const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "BNB",
  ADA: "Cardano",
  SOL: "Solana",
  DOT: "Polkadot",
  DOGE: "Dogecoin",
  AVAX: "Avalanche",
  MATIC: "Polygon",
  LINK: "Chainlink",
  XRP: "XRP",
  USDT: "Tether",
  USDC: "USD Coin",
  UNI: "Uniswap",
  AAVE: "Aave",
  ATOM: "Cosmos",
  NEAR: "NEAR Protocol",
  APT: "Aptos",
  ARB: "Arbitrum",
  OP: "Optimism",
};

const BRAZILIAN_ASSET_CLASSES: readonly AssetClass[] = ["stocks", "fii", "bdr"];
const INTERNATIONAL_ASSET_CLASSES: readonly AssetClass[] = ["international_stocks", "international_etf"];

/** B3 tickers end with a digit (PETR4, VALE3, HGLG11, BOVA11). */
export function isBrazilianTicker(ticker: string): boolean {
  return /\d$/.test(ticker);
}

/** Where a ticker is priced: its holding's asset class decides, else the ticker's shape. */
export function quoteSourceFor(ticker: string, assetClass?: AssetClass | null): QuoteSource | null {
  const t = ticker.toUpperCase();
  if (assetClass === "crypto") return CRYPTO_SYMBOL_TO_COINGECKO_ID[t] ? "coingecko" : null;
  if (assetClass === "fixed_income" || assetClass === "savings") return null;
  if (assetClass && BRAZILIAN_ASSET_CLASSES.includes(assetClass)) return "brapi";
  if (assetClass && INTERNATIONAL_ASSET_CLASSES.includes(assetClass)) return "yahoo";
  if (!assetClass && CRYPTO_SYMBOL_TO_COINGECKO_ID[t]) return "coingecko";
  return isBrazilianTicker(t) ? "brapi" : "yahoo";
}

// ---------------------------------------------------------------------------
// CoinGecko
// ---------------------------------------------------------------------------

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";

/** Crypto prices in `currency`, keyed by upper-case symbol. */
export async function fetchCryptoQuotes(tickers: string[], currency = "usd"): Promise<Record<string, Quote>> {
  const symbols = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => CRYPTO_SYMBOL_TO_COINGECKO_ID[t]);
  if (!symbols.length) return {};
  const vs = currency.toLowerCase();
  const ids = symbols.map((s) => CRYPTO_SYMBOL_TO_COINGECKO_ID[s]).join(",");
  const data = await getJson<Record<string, Record<string, number>>>(`${COINGECKO_API}?ids=${ids}&vs_currencies=${vs}&include_last_updated_at=true`, "CoinGecko");
  if (!data) return {};
  const quotes: Record<string, Quote> = {};
  for (const symbol of symbols) {
    const row = data[CRYPTO_SYMBOL_TO_COINGECKO_ID[symbol]];
    const price = row?.[vs];
    if (typeof price === "number" && price > 0) {
      quotes[symbol] = { ticker: symbol, price, currency: vs.toUpperCase(), source: "coingecko", asOf: isoOrNull(row.last_updated_at) };
    }
  }
  return quotes;
}

// ---------------------------------------------------------------------------
// brapi.dev
// ---------------------------------------------------------------------------

const BRAPI_API = "https://brapi.dev/api";

const withToken = (url: string, token?: string) => (token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url);

/** B3 quotes keyed by upper-case ticker. */
export async function fetchBrazilianQuotes(tickers: string[], token?: string): Promise<Record<string, Quote>> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return {};
  const data = await getJson<{ results?: { symbol?: string; regularMarketPrice?: number; currency?: string; regularMarketTime?: string }[] }>(
    withToken(`${BRAPI_API}/quote/${list.map(encodeURIComponent).join(",")}`, token),
    "brapi.dev"
  );
  const quotes: Record<string, Quote> = {};
  for (const r of data?.results ?? []) {
    if (!r.symbol || !r.regularMarketPrice) continue;
    const ticker = r.symbol.toUpperCase();
    quotes[ticker] = { ticker, price: r.regularMarketPrice, currency: (r.currency ?? "BRL").toUpperCase(), source: "brapi", asOf: isoOrNull(r.regularMarketTime) };
  }
  return quotes;
}

interface BrapiListItem {
  stock?: string;
  name?: string;
  close?: number | null;
  type?: string;
}

const ETF_NAME = /\b(ETF|ISHARES|[IÍ]NDICE|IT NOW|TREND|HASHDEX)\b/i;

/** brapi's stock / fund / bdr, mapped to an asset class (a "fund" is an ETF when its name says so, else a FII). */
export function brapiAssetClass(type: string | undefined, name: string): AssetClass {
  if (type === "bdr") return "bdr";
  if (type === "fund") return ETF_NAME.test(name) ? "etf" : "fii";
  return "stocks";
}

async function searchBrapi(q: string, token?: string, limit = 8): Promise<AssetSearchResult[]> {
  const data = await getJson<{ stocks?: BrapiListItem[] }>(withToken(`${BRAPI_API}/quote/list?search=${encodeURIComponent(q)}&limit=${limit}`, token), "brapi.dev search");
  return (data?.stocks ?? [])
    .filter((s): s is BrapiListItem & { stock: string } => !!s.stock)
    .map((s) => ({
      ticker: s.stock.toUpperCase(),
      name: s.name ?? s.stock,
      assetClass: brapiAssetClass(s.type, s.name ?? ""),
      currency: "BRL",
      price: typeof s.close === "number" && s.close > 0 ? s.close : null,
      source: "brapi" as const,
    }));
}

// ---------------------------------------------------------------------------
// Yahoo Finance
// ---------------------------------------------------------------------------

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
  isYahooFinance?: boolean;
}

interface YahooClient {
  quote(ticker: string): Promise<YahooQuoteResult | null | undefined>;
  search(query: string, options?: Record<string, unknown>): Promise<{ quotes?: YahooSearchQuote[] }>;
}

let yahoo: YahooClient | null = null;

async function yahooClient(): Promise<YahooClient> {
  if (yahoo) return yahoo;
  // Dynamic import keeps the library out of client bundles and SSR of pages.
  const { default: YahooFinance } = await import("yahoo-finance2");
  yahoo = new (YahooFinance as unknown as new (opts?: Record<string, unknown>) => YahooClient)({ suppressNotices: ["yahooSurvey"] });
  return yahoo;
}

/** Yahoo quotes keyed by upper-case ticker as requested (e.g. "VOO", "PETR4.SA"). */
export async function fetchYahooQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return {};
  const quotes: Record<string, Quote> = {};
  try {
    const yf = await yahooClient();
    const batchSize = 20;
    for (let i = 0; i < list.length; i += batchSize) {
      await Promise.all(
        list.slice(i, i + batchSize).map(async (ticker) => {
          try {
            const q = await yf.quote(ticker);
            if (q?.regularMarketPrice) {
              quotes[ticker] = { ticker, price: q.regularMarketPrice, currency: (q.currency ?? "USD").toUpperCase(), source: "yahoo", asOf: isoOrNull(q.regularMarketTime) };
            }
          } catch (err) {
            console.error(`[Quotes] Yahoo Finance error for ${ticker}:`, err);
          }
        })
      );
    }
  } catch (error) {
    console.error("[Quotes] Yahoo Finance failed:", error);
  }
  return quotes;
}

async function searchYahoo(q: string, limit = 6): Promise<AssetSearchResult[]> {
  let found: YahooSearchQuote[] = [];
  try {
    const yf = await yahooClient();
    found = (await yf.search(q, { quotesCount: limit, newsCount: 0 })).quotes ?? [];
  } catch (error) {
    console.error("[Quotes] Yahoo Finance search failed:", error);
    return [];
  }
  const picked = found
    .filter((r): r is YahooSearchQuote & { symbol: string } => !!r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF"))
    // B3 tickers come from brapi.
    .filter((r) => !r.symbol.toUpperCase().endsWith(".SA"))
    .slice(0, 4);
  const prices = await fetchYahooQuotes(picked.map((r) => r.symbol));
  return picked.map((r) => {
    const ticker = r.symbol.toUpperCase();
    return {
      ticker,
      name: r.longname ?? r.shortname ?? ticker,
      assetClass: r.quoteType === "ETF" ? ("international_etf" as const) : ("international_stocks" as const),
      currency: prices[ticker]?.currency ?? "USD",
      price: prices[ticker]?.price ?? null,
      source: "yahoo" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface QuoteOptions {
  brapiToken?: string;
  /** Currency for crypto without an explicit one (default USD). */
  cryptoCurrency?: string;
}

/**
 * Quotes for the requested tickers, keyed by upper-case ticker. B3 tickers
 * brapi misses are retried on Yahoo as "<ticker>.SA". Crypto is priced per
 * requested currency.
 */
export async function fetchQuotes(requests: QuoteRequest[], opts: QuoteOptions = {}): Promise<Record<string, Quote>> {
  const brazilian = new Set<string>();
  const international = new Set<string>();
  const cryptoByCurrency = new Map<string, Set<string>>();
  for (const r of requests) {
    const ticker = r.ticker.trim().toUpperCase();
    if (!ticker) continue;
    const source = quoteSourceFor(ticker, r.assetClass);
    if (source === "brapi") brazilian.add(ticker);
    else if (source === "yahoo") international.add(ticker);
    else if (source === "coingecko") {
      const cur = (r.currency ?? opts.cryptoCurrency ?? "USD").toUpperCase();
      cryptoByCurrency.set(cur, (cryptoByCurrency.get(cur) ?? new Set()).add(ticker));
    }
  }
  const [br, intl, ...crypto] = await Promise.all([
    fetchBrazilianQuotes([...brazilian], opts.brapiToken),
    fetchYahooQuotes([...international]),
    ...[...cryptoByCurrency].map(([cur, tickers]) => fetchCryptoQuotes([...tickers], cur)),
  ]);
  const missing = [...brazilian].filter((t) => !br[t]);
  const fallback: Record<string, Quote> = {};
  if (missing.length) {
    const sa = await fetchYahooQuotes(missing.map((t) => `${t}.SA`));
    for (const [key, quote] of Object.entries(sa)) {
      const ticker = key.replace(/\.SA$/i, "");
      fallback[ticker] = { ...quote, ticker };
    }
  }
  return Object.assign({}, ...crypto, br, fallback, intl);
}

/**
 * Assets matching `q` from brapi (B3), Yahoo (international stocks and ETFs)
 * and the supported coins, de-duplicated by ticker, at most `limit`.
 */
export async function searchAssets(q: string, opts: QuoteOptions & { limit?: number } = {}): Promise<AssetSearchResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const upper = query.toUpperCase();
  const coins = Object.keys(CRYPTO_SYMBOL_TO_COINGECKO_ID).filter(
    (s) => s.startsWith(upper) || CRYPTO_NAMES[s].toUpperCase().includes(upper) || CRYPTO_SYMBOL_TO_COINGECKO_ID[s].toUpperCase().includes(upper)
  );
  const cryptoCurrency = (opts.cryptoCurrency ?? "USD").toUpperCase();
  const [b3, intl, coinPrices] = await Promise.all([
    searchBrapi(query, opts.brapiToken),
    searchYahoo(query),
    fetchCryptoQuotes(coins, cryptoCurrency),
  ]);
  const crypto: AssetSearchResult[] = coins.map((s) => ({
    ticker: s,
    name: CRYPTO_NAMES[s],
    assetClass: "crypto",
    currency: cryptoCurrency,
    price: coinPrices[s]?.price ?? null,
    source: "coingecko",
  }));
  const seen = new Set<string>();
  const out: AssetSearchResult[] = [];
  // Exact ticker matches first, then each source's own order.
  const all = [...b3, ...intl, ...crypto];
  for (const r of [...all.filter((r) => r.ticker === upper), ...all]) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    out.push(r);
  }
  return out.slice(0, opts.limit ?? 8);
}
