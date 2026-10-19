import { env } from "@/env";
import { redactNumbers } from "./mask";
import type { Page, PluggyAccount, PluggyClient, PluggyInvestment, PluggyInvestmentTransaction, PluggyItemPayload, PluggyTransaction } from "./types";
import { onOrAfter } from "./consent";

const API = "https://api.pluggy.ai";
const REQUEST_TIMEOUT_MS = 20_000;

interface KeyCache {
  apiKey: string;
  expiresAt: number;
}

/**
 * Server-side Pluggy client. The API key lives in memory for under two
 * hours. The client secret is sent once to /auth and never logged.
 */
export function createPluggyClient(fetchImpl: typeof fetch = fetch): PluggyClient {
  let cache: KeyCache | null = null;

  async function apiKey(): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt > now + 60_000) return cache.apiKey;
    const clientId = env.PLUGGY_CLIENT_ID;
    const clientSecret = env.PLUGGY_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Pluggy is not configured");
    const response = await fetchImpl(`${API}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Pluggy authentication failed (${response.status})`);
    const body = (await response.json()) as { apiKey?: string };
    if (!body.apiKey) throw new Error("Pluggy authentication failed");
    cache = { apiKey: body.apiKey, expiresAt: now + 110 * 60 * 1000 };
    return body.apiKey;
  }

  async function getJson<T>(path: string): Promise<T> {
    const key = await apiKey();
    const response = await fetchImpl(`${API}${path}`, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Pluggy request failed (${response.status})`);
    return (await response.json()) as T;
  }

  async function pages<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const joiner = path.includes("?") ? "&" : "?";
      const body = await getJson<Page<T>>(`${path}${joiner}pageSize=500&page=${page}`);
      out.push(...(body.results ?? []));
      const total = body.totalPages ?? 1;
      if (page >= total) return out;
      page += 1;
    }
  }

  return {
    getItem: (itemId) => getJson<PluggyItemPayload>(`/items/${encodeURIComponent(itemId)}`),
    getAccounts: (itemId) => pages<PluggyAccount>(`/accounts?itemId=${encodeURIComponent(itemId)}`),
    async getTransactions(accountId, since) {
      const rows = await pages<PluggyTransaction>(`/transactions?accountId=${encodeURIComponent(accountId)}&from=${encodeURIComponent(since)}`);
      return rows.filter((row) => onOrAfter(row.date, since));
    },
    getInvestments: (itemId) => pages<PluggyInvestment>(`/investments?itemId=${encodeURIComponent(itemId)}`),
    async getInvestmentTransactions(investmentId, since) {
      const rows = await pages<PluggyInvestmentTransaction>(`/investments/${encodeURIComponent(investmentId)}/transactions`);
      return rows.filter((row) => onOrAfter(row.tradeDate ?? row.date, since));
    },
  };
}

export function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "sync failed";
  return redactNumbers(message);
}
