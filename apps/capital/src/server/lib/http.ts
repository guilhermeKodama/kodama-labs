/**
 * One HTTP helper for every outbound integration (market quotes, FX, BCB
 * SGS, Pluggy, …): a timeout, a couple of retries with backoff that honours
 * `Retry-After`, and a typed outcome instead of `null` or a thrown error.
 *
 * Today each integration rolls its own: 5s in investments/lib/quotes.ts,
 * 20s plus one retry in investments/lib/bcb.ts, 20s in pluggy/lib/client.ts,
 * none in currencies/lib/fx-providers.ts. Callers that need the typed
 * outcome (so a cron can tell "the market didn't move" from "the source is
 * broken") should move to fetchJson; callers that only need a bounded fetch
 * can use fetchWithTimeout directly.
 */

/** fetch, injectable so tests never reach the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type FetchOutcome<T> =
  | { outcome: "ok"; data: T; status: number }
  | { outcome: "not_found"; status: number }
  /** 401/403: the request needs a credential it doesn't have (a missing or revoked API token). Never retried — the next attempt would be refused the same way. */
  | { outcome: "unauthorized"; status: number }
  | { outcome: "rate_limited"; status: number; retryAfterMs: number | null }
  | { outcome: "provider_down"; status: number | null; error: string }
  | { outcome: "schema_changed"; status: number; error: string };

export interface FetchJsonOptions<T> {
  fetcher?: FetchLike;
  init?: RequestInit;
  /** Per-attempt timeout. Default 8000ms. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 2 (3 attempts total). */
  retries?: number;
  /** Base backoff before the first retry, doubled each time. Default 300ms. */
  backoffMs?: number;
  /** A cap on how long a 429's Retry-After is honoured; longer waits fail fast as rate_limited. Default 10000ms. */
  maxRetryAfterMs?: number;
  /** Parses and validates the JSON body. Throw (or return null) for a response that doesn't look right: a renamed field, a changed shape. */
  parse?: (json: unknown) => T | null;
  /** Prefixes log lines on retry/failure, e.g. "[Quotes] brapi.dev". */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 300;
const DEFAULT_MAX_RETRY_AFTER_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds or an HTTP-date, per RFC 9110 §10.2.3. Null when absent or unparseable. */
export function retryAfterMs(header: string | null, now: Date = new Date()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

/** `fetch` with an abort timeout; throws on a network error or the timeout itself. */
export async function fetchWithTimeout(url: string, opts: { fetcher?: FetchLike; init?: RequestInit; timeoutMs?: number } = {}): Promise<Response> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetcher(url, { ...opts.init, signal: controller?.signal ?? opts.init?.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GETs (or whatever `init.method` says) `url` as JSON, with retries and a
 * typed outcome. Never throws: every failure mode, including a timeout,
 * comes back as a `FetchOutcome`.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions<T> = {}): Promise<FetchOutcome<T>> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const label = opts.label ?? url;
  const attempts = retries + 1;

  let lastError = "unknown error";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { fetcher: opts.fetcher, init: opts.init, timeoutMs: opts.timeoutMs });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (isLast) return { outcome: "provider_down", status: null, error: lastError };
      console.warn(`[http] ${label}: attempt ${attempt + 1}/${attempts} failed (${lastError}), retrying`);
      await sleep(backoffMs * 2 ** attempt);
      continue;
    }

    if (res.status === 404) return { outcome: "not_found", status: res.status };
    if (res.status === 401 || res.status === 403) {
      console.warn(`[http] ${label}: refused (HTTP ${res.status}) — missing or invalid credential`);
      return { outcome: "unauthorized", status: res.status };
    }

    if (res.status === 429) {
      const wait = retryAfterMs(res.headers.get("retry-after"));
      if (isLast || wait === null || wait > maxRetryAfterMs) return { outcome: "rate_limited", status: res.status, retryAfterMs: wait };
      console.warn(`[http] ${label}: rate limited, waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      if (isLast) return { outcome: "provider_down", status: res.status, error: lastError };
      console.warn(`[http] ${label}: attempt ${attempt + 1}/${attempts} failed (${lastError}), retrying`);
      await sleep(backoffMs * 2 ** attempt);
      continue;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (error) {
      // A 2xx with a body that isn't JSON is a success status with the wrong
      // shape, not a transient failure: retrying would get the same body.
      return { outcome: "schema_changed", status: res.status, error: error instanceof Error ? error.message : "invalid JSON" };
    }
    if (!opts.parse) return { outcome: "ok", data: json as T, status: res.status };
    try {
      const parsed = opts.parse(json);
      if (parsed === null) return { outcome: "schema_changed", status: res.status, error: "unexpected response shape" };
      return { outcome: "ok", data: parsed, status: res.status };
    } catch (error) {
      return { outcome: "schema_changed", status: res.status, error: error instanceof Error ? error.message : "unexpected response shape" };
    }
  }

  // Unreachable: the loop above always returns on its last iteration.
  return { outcome: "provider_down", status: null, error: lastError };
}
