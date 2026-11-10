import type { AssetClass } from "@/generated/prisma";
import { fetchJson } from "@capital/server/lib/http";

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
 * brapi's free plan prices one ticker per request (comma-joining them is a
 * paid-plan feature that silently returns just the first ticker on Free),
 * so every ticker is its own request, a few at a time.
 *
 * Nothing throws: a missing ticker is "no quote", same as before, but every
 * attempt is also recorded with a reason (see QuoteAttempt) so a caller that
 * wants to know *why* can ask fetchQuotesDetailed instead of fetchQuotes.
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

/** Why a ticker did not come back with a price. "ok" means it did. */
export type QuoteOutcome = "ok" | "no_source" | "not_found" | "rate_limited" | "provider_down" | "schema_changed";

export interface QuoteAttempt {
  /** Upper-cased, as requested. */
  ticker: string;
  /** Null when no provider covers this ticker's class at all (quoteSourceFor returned null). */
  source: QuoteSource | null;
  outcome: QuoteOutcome;
  error?: string;
}

export interface QuoteBatchResult {
  quotes: Record<string, Quote>;
  attempts: QuoteAttempt[];
}

/** How fetchQuotes/update-prices key a request: crypto by ticker+currency (the same coin can be priced in two currencies in one batch), everything else by ticker. */
export function quoteRequestKey(req: QuoteRequest): string {
  return req.assetClass === "crypto" ? `${req.ticker.toUpperCase()}:${(req.currency ?? "USD").toUpperCase()}` : req.ticker.toUpperCase();
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

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

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

/** Where a ticker is priced: its holding's asset class decides, else the ticker's shape. Null when nothing prices this class today (fixed income, savings). */
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
// Price staleness (also read by services/portfolio.ts for the per-holding
// badge, and by health/routes/market-data.ts for the holdings aggregate —
// one threshold, shared, so the two never drift apart).
// ---------------------------------------------------------------------------

/** How long a price is trusted before a holding counts as stale. Matches update-prices' schedule (every 6h) plus slack. */
export const PRICE_STALE_HOURS = 8;

export type PriceStatus = "fresh" | "stale" | "unpriced" | "unsupported" | "no_ticker";

/** What a holding's own fields say about its price, with no DB access: usable from a single row or a list. */
export function holdingPriceStatus(
  h: { ticker: string | null; assetClass: AssetClass; currentPrice: number | null; lastPriceUpdate: Date | null },
  now: Date = new Date(),
): PriceStatus {
  if (!h.ticker) return "no_ticker";
  if (!quoteSourceFor(h.ticker, h.assetClass)) return "unsupported";
  if (h.currentPrice === null || h.lastPriceUpdate === null) return "unpriced";
  const ageHours = (now.getTime() - h.lastPriceUpdate.getTime()) / 3_600_000;
  return ageHours <= PRICE_STALE_HOURS ? "fresh" : "stale";
}

// ---------------------------------------------------------------------------
// CoinGecko
// ---------------------------------------------------------------------------

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";

interface CoinGeckoPriceBody {
  [coinId: string]: { [currency: string]: number } & { last_updated_at?: number };
}

function parseCoinGeckoBody(body: unknown): CoinGeckoPriceBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("expected an object keyed by coin id");
  return body as CoinGeckoPriceBody;
}

/** Crypto prices in `currency`, keyed by upper-case symbol, plus one attempt per requested symbol. */
async function fetchCryptoQuotesDetailed(tickers: string[], currency = "usd"): Promise<QuoteBatchResult> {
  const symbols = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => CRYPTO_SYMBOL_TO_COINGECKO_ID[t]);
  if (!symbols.length) return { quotes: {}, attempts: [] };
  const vs = currency.toLowerCase();
  const ids = symbols.map((s) => CRYPTO_SYMBOL_TO_COINGECKO_ID[s]).join(",");
  const result = await fetchJson(`${COINGECKO_API}?ids=${ids}&vs_currencies=${vs}&include_last_updated_at=true`, {
    label: "CoinGecko",
    parse: parseCoinGeckoBody,
  });
  const quotes: Record<string, Quote> = {};
  const attempts: QuoteAttempt[] = [];
  for (const symbol of symbols) {
    if (result.outcome !== "ok") {
      attempts.push({ ticker: symbol, source: "coingecko", outcome: result.outcome, error: "error" in result ? result.error : undefined });
      continue;
    }
    const row = result.data[CRYPTO_SYMBOL_TO_COINGECKO_ID[symbol]!];
    const price = row?.[vs];
    if (typeof price === "number" && price > 0) {
      quotes[symbol] = { ticker: symbol, price, currency: vs.toUpperCase(), source: "coingecko", asOf: isoOrNull(row.last_updated_at) };
      attempts.push({ ticker: symbol, source: "coingecko", outcome: "ok" });
    } else {
      attempts.push({ ticker: symbol, source: "coingecko", outcome: "not_found" });
    }
  }
  return { quotes, attempts };
}

/** Crypto prices in `currency`, keyed by upper-case symbol. */
export async function fetchCryptoQuotes(tickers: string[], currency = "usd"): Promise<Record<string, Quote>> {
  return (await fetchCryptoQuotesDetailed(tickers, currency)).quotes;
}

// ---------------------------------------------------------------------------
// brapi.dev
// ---------------------------------------------------------------------------

const BRAPI_API = "https://brapi.dev/api";
/** The Free plan prices one ticker per call; a few in flight at once is plenty and stays well under its per-minute limit. */
const BRAPI_CONCURRENCY = 4;

const withToken = (url: string, token?: string) => (token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url);

interface BrapiQuoteResult {
  symbol?: unknown;
  regularMarketPrice?: unknown;
  currency?: unknown;
  regularMarketTime?: unknown;
}

function parseBrapiQuoteBody(body: unknown): { results?: BrapiQuoteResult[] } {
  const results = (body as { results?: unknown } | null)?.results;
  if (results !== undefined && !Array.isArray(results)) throw new Error("results is not an array");
  return { results: results as BrapiQuoteResult[] | undefined };
}

async function fetchOneBrazilianQuote(ticker: string, token: string | undefined): Promise<QuoteAttempt & { quote?: Quote }> {
  const result = await fetchJson(withToken(`${BRAPI_API}/quote/${encodeURIComponent(ticker)}`, token), {
    label: `brapi.dev ${ticker}`,
    parse: parseBrapiQuoteBody,
  });
  if (result.outcome !== "ok") return { ticker, source: "brapi", outcome: result.outcome, error: "error" in result ? result.error : undefined };
  const row = result.data.results?.[0];
  const symbol = typeof row?.symbol === "string" ? row.symbol.toUpperCase() : null;
  const price = typeof row?.regularMarketPrice === "number" ? row.regularMarketPrice : null;
  if (!row || !symbol || !price) return { ticker, source: "brapi", outcome: "not_found" };
  // A quote for a different symbol than asked is rejected, not mis-keyed under the wrong ticker.
  if (symbol !== ticker) return { ticker, source: "brapi", outcome: "not_found" };
  return {
    ticker,
    source: "brapi",
    outcome: "ok",
    quote: { ticker, price, currency: typeof row.currency === "string" ? row.currency.toUpperCase() : "BRL", source: "brapi", asOf: isoOrNull(row.regularMarketTime) },
  };
}

async function fetchBrazilianQuotesDetailed(tickers: string[], token?: string): Promise<QuoteBatchResult> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return { quotes: {}, attempts: [] };
  const attempts = await mapWithConcurrency(list, BRAPI_CONCURRENCY, (ticker) => fetchOneBrazilianQuote(ticker, token));
  const quotes: Record<string, Quote> = {};
  for (const a of attempts) if (a.quote) quotes[a.ticker] = a.quote;
  return { quotes, attempts: attempts.map((a): QuoteAttempt => ({ ticker: a.ticker, source: a.source, outcome: a.outcome, error: a.error })) };
}

/** B3 quotes keyed by upper-case ticker, one request per ticker (the Free plan does not accept more). */
export async function fetchBrazilianQuotes(tickers: string[], token?: string): Promise<Record<string, Quote>> {
  return (await fetchBrazilianQuotesDetailed(tickers, token)).quotes;
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
  const result = await fetchJson<{ stocks?: BrapiListItem[] }>(withToken(`${BRAPI_API}/quote/list?search=${encodeURIComponent(q)}&limit=${limit}`, token), {
    label: "brapi.dev search",
    retries: 1,
  });
  if (result.outcome !== "ok") return [];
  return (result.data.stocks ?? [])
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
const YAHOO_BATCH_SIZE = 20;

async function fetchYahooQuotesDetailed(tickers: string[]): Promise<QuoteBatchResult> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return { quotes: {}, attempts: [] };
  const quotes: Record<string, Quote> = {};
  const attempts: QuoteAttempt[] = [];
  let client: YahooClient;
  try {
    client = await yahooClient();
  } catch (error) {
    console.error("[Quotes] Yahoo Finance failed:", error);
    return { quotes: {}, attempts: list.map((ticker) => ({ ticker, source: "yahoo", outcome: "provider_down", error: error instanceof Error ? error.message : String(error) })) };
  }
  for (let i = 0; i < list.length; i += YAHOO_BATCH_SIZE) {
    await Promise.all(
      list.slice(i, i + YAHOO_BATCH_SIZE).map(async (ticker) => {
        try {
          const q = await withTimeout(client.quote(ticker), YAHOO_TIMEOUT_MS);
          if (q?.regularMarketPrice) {
            quotes[ticker] = { ticker, price: q.regularMarketPrice, currency: (q.currency ?? "USD").toUpperCase(), source: "yahoo", asOf: isoOrNull(q.regularMarketTime) };
            attempts.push({ ticker, source: "yahoo", outcome: "ok" });
          } else {
            attempts.push({ ticker, source: "yahoo", outcome: "not_found" });
          }
        } catch (err) {
          console.error(`[Quotes] Yahoo Finance error for ${ticker}:`, err);
          attempts.push({ ticker, source: "yahoo", outcome: "provider_down", error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
  }
  return { quotes, attempts };
}

/** Yahoo quotes keyed by upper-case ticker as requested (e.g. "VOO", "PETR4.SA"). */
export async function fetchYahooQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  return (await fetchYahooQuotesDetailed(tickers)).quotes;
}

async function searchYahoo(q: string, limit = 6): Promise<AssetSearchResult[]> {
  let found: YahooSearchQuote[] = [];
  try {
    const yf = await yahooClient();
    found = (await withTimeout(yf.search(q, { quotesCount: limit, newsCount: 0 }), YAHOO_TIMEOUT_MS)).quotes ?? [];
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

function mergeAttempts(...batches: QuoteAttempt[][]): QuoteAttempt[] {
  return batches.flat();
}

/**
 * Quotes for the requested tickers, keyed by upper-case ticker, plus one
 * attempt per ticker recording why it does or doesn't have a price. B3
 * tickers brapi misses are retried on Yahoo as "<ticker>.SA" (that retry's
 * attempt is reported as "yahoo", since that's the source whose result
 * actually decided the outcome). Crypto is priced per requested currency.
 */
export async function fetchQuotesDetailed(requests: QuoteRequest[], opts: QuoteOptions = {}): Promise<QuoteBatchResult> {
  const brazilian = new Set<string>();
  const international = new Set<string>();
  const cryptoByCurrency = new Map<string, Set<string>>();
  const noSource: QuoteAttempt[] = [];
  for (const r of requests) {
    const ticker = r.ticker.trim().toUpperCase();
    if (!ticker) continue;
    const source = quoteSourceFor(ticker, r.assetClass);
    if (source === "brapi") brazilian.add(ticker);
    else if (source === "yahoo") international.add(ticker);
    else if (source === "coingecko") {
      const cur = (r.currency ?? opts.cryptoCurrency ?? "USD").toUpperCase();
      cryptoByCurrency.set(cur, (cryptoByCurrency.get(cur) ?? new Set()).add(ticker));
    } else {
      noSource.push({ ticker, source: null, outcome: "no_source" });
    }
  }
  const [br, intl, ...crypto] = await Promise.all([
    fetchBrazilianQuotesDetailed([...brazilian], opts.brapiToken),
    fetchYahooQuotesDetailed([...international]),
    ...[...cryptoByCurrency].map(([cur, tickers]) => fetchCryptoQuotesDetailed([...tickers], cur)),
  ]);
  const missing = [...brazilian].filter((t) => !br.quotes[t]);
  let fallback: QuoteBatchResult = { quotes: {}, attempts: [] };
  if (missing.length) {
    const sa = await fetchYahooQuotesDetailed(missing.map((t) => `${t}.SA`));
    const quotes: Record<string, Quote> = {};
    for (const [key, quote] of Object.entries(sa.quotes)) {
      const ticker = key.replace(/\.SA$/i, "");
      quotes[ticker] = { ...quote, ticker };
    }
    const attempts = sa.attempts.map((a) => ({ ...a, ticker: a.ticker.replace(/\.SA$/i, "") }));
    fallback = { quotes, attempts };
  }
  // The B3 attempt for a ticker brapi missed is replaced by the fallback's, so one attempt speaks for each ticker.
  const fallbackTickers = new Set(fallback.attempts.map((a) => a.ticker));
  const brAttempts = br.attempts.filter((a) => !fallbackTickers.has(a.ticker));
  return {
    quotes: { ...Object.fromEntries(crypto.flatMap((c) => Object.entries(c.quotes))), ...br.quotes, ...fallback.quotes, ...intl.quotes },
    attempts: mergeAttempts(noSource, crypto.flatMap((c) => c.attempts), brAttempts, fallback.attempts, intl.attempts),
  };
}

/**
 * Quotes for the requested tickers, keyed by upper-case ticker. B3 tickers
 * brapi misses are retried on Yahoo as "<ticker>.SA". Crypto is priced per
 * requested currency. See fetchQuotesDetailed for *why* a ticker is missing.
 */
export async function fetchQuotes(requests: QuoteRequest[], opts: QuoteOptions = {}): Promise<Record<string, Quote>> {
  return (await fetchQuotesDetailed(requests, opts)).quotes;
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
    (s) => s.startsWith(upper) || CRYPTO_NAMES[s]!.toUpperCase().includes(upper) || CRYPTO_SYMBOL_TO_COINGECKO_ID[s]!.toUpperCase().includes(upper),
  );
  const cryptoCurrency = (opts.cryptoCurrency ?? "USD").toUpperCase();
  const [b3, intl, coinPrices] = await Promise.all([searchBrapi(query, opts.brapiToken), searchYahoo(query), fetchCryptoQuotes(coins, cryptoCurrency)]);
  const crypto: AssetSearchResult[] = coins.map((s) => ({
    ticker: s,
    name: CRYPTO_NAMES[s]!,
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
