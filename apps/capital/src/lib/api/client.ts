/**
 * Fetch wrapper for the app's own API (/api/v2, and /api/v1 for the
 * assistant, fire and push). It sends the session cookie, encodes JSON
 * bodies and turns every non-2xx answer into an ApiError that keeps the
 * server's error code, so the UI can show a localized message
 * (errors.ts) instead of the server's English text.
 */

/** One field problem from a 422 validation answer. `path` is dotted ("legs.0.amount"). */
export interface ApiIssue {
  path: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  /** HTTP status; 0 when the request never got an answer (offline, DNS, CORS). */
  readonly status: number;
  /** Stable reason, e.g. "undo.newer_change" or "validation"; null when the server sent none. */
  readonly code: string | null;
  /** Values for the localized message of `code`. */
  readonly params: Record<string, unknown>;
  readonly issues: ApiIssue[];

  constructor(init: { status: number; message: string; code?: string | null; params?: Record<string, unknown>; issues?: ApiIssue[] }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code ?? null;
    this.params = init.params ?? {};
    this.issues = init.issues ?? [];
  }
}

/** Status of an ApiError for a request that got no HTTP answer. */
export const NETWORK_STATUS = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

function readIssues(raw: unknown): ApiIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join(".") : (text(issue.path) ?? ""),
    code: text(issue.code) ?? "invalid",
    message: text(issue.message) ?? "",
  }));
}

/**
 * Builds the ApiError for an error answer. Understands the three shapes the
 * server sends:
 * - v2: `{message, code?, params?, issues?}` (422 validation adds `code: "validation"`);
 * - v1 (assistant, fire, push): `{error: {code, message}}`;
 * - stoker's default validation hook: `{success: false, error: {issues, name: "ZodError"}}`.
 * Anything else (HTML, empty body) keeps only the status.
 */
export function parseApiError(status: number, body: unknown, fallbackMessage = ""): ApiError {
  const record = isRecord(body) ? body : {};
  const nested = isRecord(record.error) ? record.error : {};
  const issues = readIssues(record.issues ?? nested.issues);
  const code = text(record.code) ?? text(nested.code) ?? (issues.length > 0 ? "validation" : null);
  const params = isRecord(record.params) ? record.params : isRecord(nested.params) ? nested.params : {};
  const message =
    text(record.message) ?? text(nested.message) ?? (typeof body === "string" ? text(body.trim()) : null) ?? (fallbackMessage || `HTTP ${status}`);
  return new ApiError({ status, message, code, params, issues });
}

async function readErrorBody(res: Response): Promise<unknown> {
  const raw = await res.text().catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Calls the API and returns the parsed body: JSON for JSON answers, a
 * string for text ones (CSV export), undefined for 204. Throws ApiError on
 * any non-2xx answer and on network failures; aborts are rethrown as is.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  let res: Response;
  try {
    // no-store: React Query is the only cache. The browser's HTTP cache could
    // otherwise answer a GET with data from before the last write.
    res = await fetch(path, { credentials: "include", cache: "no-store", ...init, headers });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError({ status: NETWORK_STATUS, code: "network", message: error instanceof Error ? error.message : String(error) });
  }
  if (!res.ok) throw parseApiError(res.status, await readErrorBody(res), res.statusText);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const raw = await res.text();
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
  if (type.startsWith("text/")) return (await res.text()) as T;
  return (await res.blob()) as T;
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * Appends query parameters, skipping null, undefined and empty arrays.
 * Arrays are sent comma-separated (`tickers=PETR4,VALE3`).
 */
export function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(","));
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

export function apiGet<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  return api<T>(params ? withQuery(path, params) : path);
}

export function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}

/** Multipart upload; the browser sets the boundary header. */
export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: "POST", body: form });
}

/** 401/403: the session is gone or was never there. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
