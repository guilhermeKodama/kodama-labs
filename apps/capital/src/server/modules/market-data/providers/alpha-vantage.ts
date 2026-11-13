import type { FetchOutcome } from "@capital/server/lib/http";
import { fetchWithTimeout, retryAfterMs } from "@capital/server/lib/http";
import { env } from "@/env";
import { reserveAlphaVantageCall } from "../lib/alpha-vantage-budget";
import type { MarketDataProvider, PricePoint } from "../lib/provider";

/**
 * Alpha Vantage — international stocks and ETFs, via the official
 * GLOBAL_QUOTE endpoint. Replaces Yahoo: that path depended on
 * yahoo-finance2's cookie/crumb scrape of finance.yahoo.com, which timed
 * out and failed with EAI_AGAIN in production, while this keyed REST call
 * does not.
 *
 * Free tier: 25 requests/day and 5 per minute. The daily market-close job
 * prices about a dozen international listings once. Every call goes through
 * one process-wide queue with a 13s gap (5/minute is one call every 12s;
 * the extra second is slack) and through the daily counter in
 * alpha-vantage-budget.ts, which stops at 22. There is no retry: a second
 * attempt would spend another of the 25 and, for a dozen names, push the
 * cron past its runtime. A timeout is 5s. A 200 body with "Note" or
 * "Information" is Alpha Vantage's rate-limit signal — rate_limited, and
 * not retried — unless the text says the key is invalid or the endpoint
 * needs a premium subscription, which is unauthorized.
 *
 * GLOBAL_QUOTE has no currency. A bare US symbol, and the two USD-quoted
 * LSE UCITS listings (VUAA.LON, CNDX.LON), are USD. Any other dotted symbol
 * leaves the currency blank; sync-prices fills it from the asset (LSE
 * quotes in pence when the asset is GBP). acceptPrice still rejects a
 * point whose currency is not the asset's.
 */

export const ALPHA_VANTAGE_SOURCE = "alpha_vantage";

/** One call every 13s stays under the free tier's 5 requests per minute. */
export const ALPHA_VANTAGE_MIN_GAP_MS = 13_000;

const TIMEOUT_MS = 5_000;
const QUOTE_URL = "https://www.alphavantage.co/query";

/**
 * Vendor symbol for a listing. US tickers stay as they are. LSE listings
 * use Alpha Vantage's `.LON` suffix: the bare UCITS symbols VUAA and CNDX
 * (and Yahoo's `.L` form) do not resolve.
 */
export function alphaVantageExternalId(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper === "VUAA" || upper === "VUAA.L" || upper === "VUAA.LON") return "VUAA.LON";
  if (upper === "CNDX" || upper === "CNDX.L" || upper === "CNDX.LON") return "CNDX.LON";
  if (upper.endsWith(".L")) return `${upper.slice(0, -2)}.LON`;
  return upper;
}

/** Quote currency GLOBAL_QUOTE does not return. See the module comment. */
const QUOTE_CURRENCY: Record<string, string> = {
  "VUAA.LON": "USD",
  "CNDX.LON": "USD",
};

/** USD for a bare US symbol and the known USD LSE listings. Null for any other dotted symbol: the quote does not say, and guessing USD was wrong. */
export function alphaVantageCurrency(symbol: string): string | null {
  const id = alphaVantageExternalId(symbol);
  if (QUOTE_CURRENCY[id]) return QUOTE_CURRENCY[id];
  if (!id.includes(".")) return "USD";
  return null;
}

/**
 * Fills a blank Alpha Vantage currency from the asset before acceptPrice.
 * A set currency is left alone, so a mismatch is still rejected. LSE quotes
 * of a GBP listing come back in pence (GBX): divide by 100. A listing the
 * asset already calls GBX stays in pence. USD LSE listings are not rescaled.
 * Any other currency on `.LON` is unknown and the point is dropped.
 * A non-LSE suffix (SHOP.TO) takes the asset's currency as-is.
 */
export function applyAlphaVantageCurrency(externalId: string, point: PricePoint, assetCurrency: string): PricePoint | null {
  if (point.currency) return point;
  const id = alphaVantageExternalId(externalId);
  const asset = assetCurrency.trim().toUpperCase();
  if (id.endsWith(".LON")) {
    if (asset === "GBP") return { ...point, close: point.close / 100, currency: "GBP" };
    if (asset === "GBX") return { ...point, currency: "GBX" };
    if (asset === "USD") return { ...point, currency: "USD" };
    return null;
  }
  if (!asset) return null;
  return { ...point, currency: asset };
}

// Vitest sets VITEST. The suite must not wait 13s between mocked calls; the
// pacing test puts the real gap back with resetAlphaVantagePacing.
let gapMs = process.env.VITEST ? 0 : ALPHA_VANTAGE_MIN_GAP_MS;
let lastStartedAt = 0;
let chain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tests set the gap to 0 so the suite does not wait out the free-tier pace. */
export function resetAlphaVantagePacing(nextGapMs: number = ALPHA_VANTAGE_MIN_GAP_MS): void {
  gapMs = nextGapMs;
  lastStartedAt = 0;
  chain = Promise.resolve();
}

/** Serializes every Alpha Vantage call in this process. The gap is between request starts. */
function pace(): Promise<void> {
  const ticket = chain.then(async () => {
    const elapsed = Date.now() - lastStartedAt;
    if (lastStartedAt !== 0 && elapsed < gapMs) await sleep(gapMs - elapsed);
    lastStartedAt = Date.now();
  });
  chain = ticket.then(
    () => undefined,
    () => undefined,
  );
  return ticket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** Alpha Vantage says this in a 200 body when the key is bad or the call needs a paid plan. */
function isCredentialMessage(text: string): boolean {
  return /api\s*key|apikey|premium/i.test(text);
}

function classifyQuote(body: unknown, status: number, symbol: string): FetchOutcome<PricePoint[]> {
  if (!isRecord(body)) return { outcome: "schema_changed", status, error: "unexpected response shape" };
  const note = textField(body, "Note") ?? textField(body, "Information");
  if (note) {
    if (isCredentialMessage(note)) {
      console.warn(`[http] Alpha Vantage ${symbol}: rejected the key (${note.slice(0, 120)})`);
      return { outcome: "unauthorized", status };
    }
    console.warn(`[http] Alpha Vantage ${symbol}: rate limited (${note.slice(0, 120)})`);
    return { outcome: "rate_limited", status, retryAfterMs: null };
  }
  if (textField(body, "Error Message")) return { outcome: "not_found", status };
  if (!("Global Quote" in body)) return { outcome: "schema_changed", status, error: "missing Global Quote" };
  const quote = body["Global Quote"];
  if (!isRecord(quote)) return { outcome: "schema_changed", status, error: "Global Quote is not an object" };
  const priceRaw = quote["05. price"];
  const price = typeof priceRaw === "string" || typeof priceRaw === "number" ? Number(priceRaw) : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) return { outcome: "not_found", status };
  const day = quote["07. latest trading day"];
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { outcome: "schema_changed", status, error: "missing latest trading day" };
  }
  const point: PricePoint = { date: day, close: price, currency: alphaVantageCurrency(symbol) ?? "" };
  return { outcome: "ok", status, data: [point] };
}

function quoteUrl(symbol: string, apiKey: string): string {
  const url = new URL(QUOTE_URL);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

async function fetchPrices(externalId: string): Promise<FetchOutcome<PricePoint[]>> {
  const apiKey = env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) return { outcome: "unauthorized", status: 401 };
  const symbol = alphaVantageExternalId(externalId);
  // Reserve before the pace, so a day that is already full does not wait 13s to do nothing.
  const reserved = await reserveAlphaVantageCall();
  if (!reserved.ok) return { outcome: "rate_limited", status: 429, retryAfterMs: reserved.retryAfterMs };

  await pace();
  const url = quoteUrl(symbol, apiKey);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      timeoutMs: TIMEOUT_MS,
      init: { headers: { accept: "application/json" } },
    });
  } catch (error) {
    return { outcome: "provider_down", status: null, error: error instanceof Error ? error.message : String(error) };
  }

  if (res.status === 404) return { outcome: "not_found", status: res.status };
  if (res.status === 401 || res.status === 403) return { outcome: "unauthorized", status: res.status };
  if (res.status === 429) return { outcome: "rate_limited", status: res.status, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
  if (!res.ok) return { outcome: "provider_down", status: res.status, error: `HTTP ${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    return { outcome: "schema_changed", status: res.status, error: error instanceof Error ? error.message : "invalid JSON" };
  }
  return classifyQuote(json, res.status, symbol);
}

export const alphaVantageProvider: MarketDataProvider = {
  id: ALPHA_VANTAGE_SOURCE,
  capabilities: ["prices"],
  markets: ["international_stocks", "international_etf", "etf"],
  fetchPrices,
};
