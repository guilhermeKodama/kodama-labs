import type { FetchOutcome } from "@capital/server/lib/http";
import { fetchWithTimeout, retryAfterMs } from "@capital/server/lib/http";
import { env } from "@/env";
import type { MarketDataProvider, PricePoint } from "../lib/provider";

/**
 * Alpha Vantage — international stocks and ETFs, via the official
 * GLOBAL_QUOTE endpoint. Replaces Yahoo: that path depended on
 * yahoo-finance2's cookie/crumb scrape of finance.yahoo.com, which timed
 * out and failed with EAI_AGAIN in production, while this keyed REST call
 * does not.
 *
 * Free tier: 25 requests/day and 5 per minute. The daily market-close job
 * prices about a dozen international listings once, so every call goes
 * through one process-wide queue with a 13s gap (5/minute is one call
 * every 12s; the extra second is slack) and a single retry on a transient
 * failure. A 200 body with "Note" or "Information" is Alpha Vantage's
 * rate-limit signal — rate_limited, and not retried, because another call
 * would spend the daily budget and fail the same way.
 *
 * GLOBAL_QUOTE has no currency. US symbols and the USD-quoted LSE UCITS
 * listings (VUAA.LON, CNDX.LON) are USD. acceptPrice rejects a point whose
 * currency is not the asset's.
 */

export const ALPHA_VANTAGE_SOURCE = "alpha_vantage";

/** One call every 13s stays under the free tier's 5 requests per minute. */
export const ALPHA_VANTAGE_MIN_GAP_MS = 13_000;

const TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;
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

export function alphaVantageCurrency(symbol: string): string {
  const id = alphaVantageExternalId(symbol);
  return QUOTE_CURRENCY[id] ?? "USD";
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

/** Serializes every Alpha Vantage call in this process, including retries. */
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

function classifyQuote(body: unknown, status: number, symbol: string): FetchOutcome<PricePoint[]> {
  if (!isRecord(body)) return { outcome: "schema_changed", status, error: "unexpected response shape" };
  const note = textField(body, "Note") ?? textField(body, "Information");
  if (note) {
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
  const point: PricePoint = { date: day, close: price, currency: alphaVantageCurrency(symbol) };
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
  const url = quoteUrl(symbol, apiKey);

  let lastError = "unknown error";
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const isLast = attempt === ATTEMPTS - 1;
    await pace();
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        timeoutMs: TIMEOUT_MS,
        init: { headers: { accept: "application/json" } },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      lastStatus = null;
      if (isLast) return { outcome: "provider_down", status: null, error: lastError };
      console.warn(`[http] Alpha Vantage ${symbol}: attempt ${attempt + 1}/${ATTEMPTS} failed (${lastError}), retrying`);
      continue;
    }

    if (res.status === 404) return { outcome: "not_found", status: res.status };
    if (res.status === 401 || res.status === 403) return { outcome: "unauthorized", status: res.status };

    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      lastStatus = res.status;
      if (isLast) {
        if (res.status === 429) return { outcome: "rate_limited", status: res.status, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
        return { outcome: "provider_down", status: res.status, error: lastError };
      }
      console.warn(`[http] Alpha Vantage ${symbol}: attempt ${attempt + 1}/${ATTEMPTS} failed (${lastError}), retrying`);
      continue;
    }

    if (!res.ok) return { outcome: "provider_down", status: res.status, error: `HTTP ${res.status}` };

    let json: unknown;
    try {
      json = await res.json();
    } catch (error) {
      return { outcome: "schema_changed", status: res.status, error: error instanceof Error ? error.message : "invalid JSON" };
    }
    const classified = classifyQuote(json, res.status, symbol);
    // A 200 rate-limit body is not transient: retrying spends another of the 25 daily calls.
    if (classified.outcome === "rate_limited") return classified;
    return classified;
  }

  return { outcome: "provider_down", status: lastStatus, error: lastError };
}

export const alphaVantageProvider: MarketDataProvider = {
  id: ALPHA_VANTAGE_SOURCE,
  capabilities: ["prices"],
  markets: ["international_stocks", "international_etf"],
  fetchPrices,
};
