import type { AssetClass } from "@/generated/prisma";
import { mapWithConcurrency } from "@capital/server/lib/concurrency";
import { activeProviders } from "@capital/server/modules/market-data/lib/registry";
import { ALPHA_VANTAGE_SOURCE } from "@capital/server/modules/market-data/providers/alpha-vantage";
import { brapiAssetClass } from "@capital/server/modules/market-data/providers/brapi";
import { CRYPTO_NAMES, CRYPTO_SYMBOL_TO_COINGECKO_ID } from "@capital/server/modules/market-data/providers/coingecko";
import { isBrazilianTicker } from "@capital/server/modules/market-data/lib/ticker";
import type { MarketDataProvider } from "@capital/server/modules/market-data/lib/provider";
import { expectedLatestSession, marketDate, marketFor, sessionsBehind } from "@capital/server/modules/market-data/lib/calendar";

/**
 * Market data fetchers shared by the price-refresh cron (services/update-prices.ts),
 * GET /v2/quotes and GET /v2/assets/search.
 *
 * The actual HTTP calls to brapi, Alpha Vantage and CoinGecko live in
 * src/server/modules/market-data/providers/*.ts — one implementation per
 * source, shared with sync-prices.ts's global AssetPrice sync. This file is
 * what's left: routing a raw ticker to a source (quoteSourceFor, unchanged —
 * it decides by the holding's asset class or, failing that, the ticker's
 * own shape, which a resolved Asset doesn't need), batching, and translating a PricePoint/InstrumentMatch into
 * this module's Quote/AssetSearchResult shape. providerById() reads the
 * registry (respecting MARKET_DATA_CHAIN/MARKET_DATA_DISABLED) rather than
 * importing a provider module directly, so disabling a source for
 * sync-prices disables it here too.
 *
 * Nothing throws: a missing ticker is "no quote", same as before, but every
 * attempt is also recorded with a reason (see QuoteAttempt) so a caller that
 * wants to know *why* can ask fetchQuotesDetailed instead of fetchQuotes.
 */

export type QuoteSource = "coingecko" | "brapi" | typeof ALPHA_VANTAGE_SOURCE;

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
export type QuoteOutcome = "ok" | "no_source" | "not_found" | "unauthorized" | "rate_limited" | "provider_down" | "schema_changed";

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

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export { CRYPTO_SYMBOL_TO_COINGECKO_ID };

const BRAZILIAN_ASSET_CLASSES: readonly AssetClass[] = ["stocks", "fii", "bdr"];
const INTERNATIONAL_ASSET_CLASSES: readonly AssetClass[] = ["international_stocks", "international_etf"];

export { isBrazilianTicker };

/** Where a ticker is priced: its holding's asset class decides, else the ticker's shape. Null when nothing prices this class today (fixed income, savings). */
export function quoteSourceFor(ticker: string, assetClass?: AssetClass | null): QuoteSource | null {
  const t = ticker.toUpperCase();
  if (assetClass === "crypto") return CRYPTO_SYMBOL_TO_COINGECKO_ID[t] ? "coingecko" : null;
  if (assetClass === "fixed_income" || assetClass === "savings") return null;
  if (assetClass && BRAZILIAN_ASSET_CLASSES.includes(assetClass)) return "brapi";
  if (assetClass && INTERNATIONAL_ASSET_CLASSES.includes(assetClass)) return ALPHA_VANTAGE_SOURCE;
  if (!assetClass && CRYPTO_SYMBOL_TO_COINGECKO_ID[t]) return "coingecko";
  return isBrazilianTicker(t) ? "brapi" : ALPHA_VANTAGE_SOURCE;
}

/** The registry's instance for a source, or undefined when it's off (MARKET_DATA_DISABLED). Reading the registry each call, not a module-level provider import, is what lets one env var turn a source off for this file too. */
function providerById(id: QuoteSource): MarketDataProvider | undefined {
  return activeProviders().find((p) => p.id === id);
}

function today(): { from: string; to: string } {
  const d = new Date().toISOString().slice(0, 10);
  return { from: d, to: d };
}

// ---------------------------------------------------------------------------
// Price staleness (also read by services/portfolio.ts for the per-holding
// badge, by notifications/services/notify.ts for the asset_stale push, and by
// health/routes/market-data.ts for the holdings aggregate — one rule, shared,
// so they never drift apart).
// ---------------------------------------------------------------------------

/**
 * How many closes a price may miss and still count as fresh. One, not zero:
 * a holiday the calendar tables don't know, or a pipeline run that hasn't
 * finished yet, must not flag every holding. Two missed closes is a real
 * gap — that is "stale", and what the asset_stale push waits for.
 */
export const PRICE_STALE_AFTER_SESSIONS = 2;

export type PriceStatus = "fresh" | "stale" | "unpriced" | "unsupported" | "no_ticker";

/**
 * What a holding's own fields say about its price, with no DB access: usable
 * from a single row or a list. Freshness is counted in trading sessions on
 * the holding's market (see market-data/lib/calendar.ts): lastPriceUpdate is
 * the quote's own instant (AssetPrice.asOf), so its date in the market's time
 * zone is the session it belongs to.
 */
export function holdingPriceStatus(
  h: { ticker: string | null; assetClass: AssetClass; currentPrice: number | null; lastPriceUpdate: Date | null },
  now: Date = new Date(),
): PriceStatus {
  if (!h.ticker) return "no_ticker";
  if (!quoteSourceFor(h.ticker, h.assetClass)) return "unsupported";
  if (h.currentPrice === null || h.lastPriceUpdate === null) return "unpriced";
  return sessionsMissed(h.ticker, h.assetClass, h.lastPriceUpdate, now) < PRICE_STALE_AFTER_SESSIONS ? "fresh" : "stale";
}

/** Closes missed since `priceAt` on the holding's market; 0 for a class with no market (never reached for those: quoteSourceFor rules them out first). */
export function sessionsMissed(ticker: string, assetClass: AssetClass, priceAt: Date, now: Date = new Date()): number {
  const market = marketFor(assetClass, ticker);
  if (!market) return 0;
  return sessionsBehind(market, marketDate(market, priceAt), expectedLatestSession(market, now));
}

// ---------------------------------------------------------------------------
// CoinGecko
// ---------------------------------------------------------------------------

/** A handful of crypto holdings at most; one request each is plenty. */
const CRYPTO_CONCURRENCY = 4;

async function fetchOneCryptoQuote(symbol: string, currency: string): Promise<QuoteAttempt & { quote?: Quote }> {
  const coinId = CRYPTO_SYMBOL_TO_COINGECKO_ID[symbol];
  if (!coinId) return { ticker: symbol, source: "coingecko", outcome: "not_found" };
  const provider = providerById("coingecko");
  if (!provider?.fetchPrices) return { ticker: symbol, source: "coingecko", outcome: "provider_down", error: "coingecko disabled via MARKET_DATA_DISABLED" };
  const result = await provider.fetchPrices(`${coinId}:${currency.toLowerCase()}`, today());
  if (result.outcome !== "ok") return { ticker: symbol, source: "coingecko", outcome: result.outcome, error: "error" in result ? result.error : undefined };
  const point = result.data[0];
  if (!point) return { ticker: symbol, source: "coingecko", outcome: "not_found" };
  return { ticker: symbol, source: "coingecko", outcome: "ok", quote: { ticker: symbol, price: point.close, currency: point.currency, source: "coingecko", asOf: point.asOf ?? null } };
}

/** Crypto prices in `currency`, keyed by upper-case symbol, plus one attempt per requested symbol. */
async function fetchCryptoQuotesDetailed(tickers: string[], currency = "usd"): Promise<QuoteBatchResult> {
  const symbols = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => CRYPTO_SYMBOL_TO_COINGECKO_ID[t]);
  if (!symbols.length) return { quotes: {}, attempts: [] };
  const attempts = await mapWithConcurrency(symbols, CRYPTO_CONCURRENCY, (s) => fetchOneCryptoQuote(s, currency));
  const quotes: Record<string, Quote> = {};
  for (const a of attempts) if (a.quote) quotes[a.ticker] = a.quote;
  return { quotes, attempts: attempts.map((a): QuoteAttempt => ({ ticker: a.ticker, source: a.source, outcome: a.outcome, error: a.error })) };
}

/** Crypto prices in `currency`, keyed by upper-case symbol. */
export async function fetchCryptoQuotes(tickers: string[], currency = "usd"): Promise<Record<string, Quote>> {
  return (await fetchCryptoQuotesDetailed(tickers, currency)).quotes;
}

// ---------------------------------------------------------------------------
// brapi.dev
// ---------------------------------------------------------------------------

/** The Free plan prices one ticker per call; a few in flight at once is plenty and stays well under its per-minute limit. */
const BRAPI_CONCURRENCY = 4;

async function fetchOneBrazilianQuote(ticker: string): Promise<QuoteAttempt & { quote?: Quote }> {
  const provider = providerById("brapi");
  if (!provider?.fetchPrices) return { ticker, source: "brapi", outcome: "provider_down", error: "brapi disabled via MARKET_DATA_DISABLED" };
  const result = await provider.fetchPrices(ticker, today());
  if (result.outcome !== "ok") return { ticker, source: "brapi", outcome: result.outcome, error: "error" in result ? result.error : undefined };
  const point = result.data[0];
  if (!point) return { ticker, source: "brapi", outcome: "not_found" };
  return { ticker, source: "brapi", outcome: "ok", quote: { ticker, price: point.close, currency: point.currency, source: "brapi", asOf: point.asOf ?? null } };
}

async function fetchBrazilianQuotesDetailed(tickers: string[]): Promise<QuoteBatchResult> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return { quotes: {}, attempts: [] };
  const attempts = await mapWithConcurrency(list, BRAPI_CONCURRENCY, (ticker) => fetchOneBrazilianQuote(ticker));
  const quotes: Record<string, Quote> = {};
  for (const a of attempts) if (a.quote) quotes[a.ticker] = a.quote;
  return { quotes, attempts: attempts.map((a): QuoteAttempt => ({ ticker: a.ticker, source: a.source, outcome: a.outcome, error: a.error })) };
}

/** B3 quotes keyed by upper-case ticker, one request per ticker (the Free plan does not accept more). `token` is accepted for API compatibility; every caller passes env.BRAPI_TOKEN, which is exactly what the brapi provider itself reads. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchBrazilianQuotes(tickers: string[], _token?: string): Promise<Record<string, Quote>> {
  return (await fetchBrazilianQuotesDetailed(tickers)).quotes;
}

export { brapiAssetClass };

async function searchBrapi(q: string): Promise<AssetSearchResult[]> {
  const provider = providerById("brapi");
  if (!provider?.lookup) return [];
  const result = await provider.lookup(q);
  if (result.outcome !== "ok") return [];
  return result.data.map((m) => ({ ticker: m.symbol, name: m.name, assetClass: m.assetClass, currency: m.currency, price: m.price ?? null, source: "brapi" as const }));
}

// ---------------------------------------------------------------------------
// Alpha Vantage
// ---------------------------------------------------------------------------

/** One at a time. The provider's own queue also keeps the free tier's 5/minute, including callers that fan out. */
const ALPHA_VANTAGE_CONCURRENCY = 1;

async function fetchOneAlphaVantageQuote(ticker: string): Promise<QuoteAttempt & { quote?: Quote }> {
  const provider = providerById(ALPHA_VANTAGE_SOURCE);
  if (!provider?.fetchPrices) return { ticker, source: ALPHA_VANTAGE_SOURCE, outcome: "provider_down", error: "alpha_vantage disabled via MARKET_DATA_DISABLED" };
  const result = await provider.fetchPrices(ticker, today());
  if (result.outcome !== "ok") return { ticker, source: ALPHA_VANTAGE_SOURCE, outcome: result.outcome, error: "error" in result ? result.error : undefined };
  const point = result.data[0];
  if (!point) return { ticker, source: ALPHA_VANTAGE_SOURCE, outcome: "not_found" };
  return { ticker, source: ALPHA_VANTAGE_SOURCE, outcome: "ok", quote: { ticker, price: point.close, currency: point.currency, source: ALPHA_VANTAGE_SOURCE, asOf: point.asOf ?? null } };
}

async function fetchAlphaVantageQuotesDetailed(tickers: string[]): Promise<QuoteBatchResult> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return { quotes: {}, attempts: [] };
  const attempts = await mapWithConcurrency(list, ALPHA_VANTAGE_CONCURRENCY, (ticker) => fetchOneAlphaVantageQuote(ticker));
  const quotes: Record<string, Quote> = {};
  for (const a of attempts) if (a.quote) quotes[a.ticker] = a.quote;
  return { quotes, attempts: attempts.map((a): QuoteAttempt => ({ ticker: a.ticker, source: a.source, outcome: a.outcome, error: a.error })) };
}

/** Alpha Vantage quotes keyed by upper-case ticker as requested (e.g. "VOO", "VUAA.LON"). */
export async function fetchAlphaVantageQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  return (await fetchAlphaVantageQuotesDetailed(tickers)).quotes;
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
 * attempt per ticker recording why it does or doesn't have a price. Crypto
 * is priced per requested currency.
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
    else if (source === ALPHA_VANTAGE_SOURCE) international.add(ticker);
    else if (source === "coingecko") {
      const cur = (r.currency ?? opts.cryptoCurrency ?? "USD").toUpperCase();
      cryptoByCurrency.set(cur, (cryptoByCurrency.get(cur) ?? new Set()).add(ticker));
    } else {
      noSource.push({ ticker, source: null, outcome: "no_source" });
    }
  }
  const [br, intl, ...crypto] = await Promise.all([
    fetchBrazilianQuotesDetailed([...brazilian]),
    fetchAlphaVantageQuotesDetailed([...international]),
    ...[...cryptoByCurrency].map(([cur, tickers]) => fetchCryptoQuotesDetailed([...tickers], cur)),
  ]);
  return {
    quotes: { ...Object.fromEntries(crypto.flatMap((c) => Object.entries(c.quotes))), ...br.quotes, ...intl.quotes },
    attempts: mergeAttempts(noSource, crypto.flatMap((c) => c.attempts), br.attempts, intl.attempts),
  };
}

/**
 * Quotes for the requested tickers, keyed by upper-case ticker. Crypto is
 * priced per requested currency. See fetchQuotesDetailed for *why* a ticker
 * is missing.
 */
export async function fetchQuotes(requests: QuoteRequest[], opts: QuoteOptions = {}): Promise<Record<string, Quote>> {
  return (await fetchQuotesDetailed(requests, opts)).quotes;
}

/**
 * Assets matching `q` from brapi (B3) and the supported coins, de-duplicated
 * by ticker, at most `limit`. Alpha Vantage has no search call: a lookup
 * would spend the free tier's 25 requests/day that the daily close needs.
 */
export async function searchAssets(q: string, opts: QuoteOptions & { limit?: number } = {}): Promise<AssetSearchResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const upper = query.toUpperCase();
  const coins = Object.keys(CRYPTO_SYMBOL_TO_COINGECKO_ID).filter(
    (s) => s.startsWith(upper) || CRYPTO_NAMES[s]!.toUpperCase().includes(upper) || CRYPTO_SYMBOL_TO_COINGECKO_ID[s]!.toUpperCase().includes(upper),
  );
  const cryptoCurrency = (opts.cryptoCurrency ?? "USD").toUpperCase();
  const [b3, coinPrices] = await Promise.all([searchBrapi(query), fetchCryptoQuotes(coins, cryptoCurrency)]);
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
  const all = [...b3, ...crypto];
  for (const r of [...all.filter((r) => r.ticker === upper), ...all]) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    out.push(r);
  }
  return out.slice(0, opts.limit ?? 8);
}
