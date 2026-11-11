import { useQuery } from "@tanstack/react-query";
import { keys } from "./keys";

/** GET /api/health/market-data — public, aggregates only. Shape mirrors src/server/modules/health/routes/market-data.ts. */
export interface JobHealth {
  job: string;
  status: "ok" | "degraded" | "down";
  lastRunAt: string | null;
  lastRunStatus: string | null;
  ageHours: number | null;
  targetHours: number;
}

export interface AssetClassHealth {
  total: number;
  priceable: number;
  fresh: number;
  stale: number;
  unpriced: number;
  unsupported: number;
  noTicker: number;
  activeProvider: string | null;
}

export interface MarketDataHealth {
  status: "ok" | "degraded" | "down";
  jobs: JobHealth[];
  /** Configuration facts, not failures (health/routes/market-data.ts MarketDataNotice). */
  notices: "brapi_no_token"[];
  holdings: {
    total: number;
    priceable: number;
    stale: number;
    byStatus: Record<string, number>;
    byAssetClass: Record<string, AssetClassHealth>;
    oldestPriceAt: string | null;
    /** Missed closes before a holding counts as stale (quotes.ts PRICE_STALE_AFTER_SESSIONS). */
    staleAfterSessions: number;
  };
}

/**
 * Not apiGet: the route answers 503 on purpose when something is down
 * (Uptime Kuma polls it for that), but the body is the same diagnostic
 * payload either way — exactly what this panel needs to show *why*. apiGet
 * assumes the v2 API's error envelope and would discard that body, so this
 * reads the response directly and only throws when the body itself isn't
 * the shape expected.
 */
async function fetchMarketDataHealth(): Promise<MarketDataHealth> {
  const res = await fetch("/api/health/market-data", { credentials: "include", cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!body || typeof body !== "object" || !("status" in body) || !("jobs" in body)) {
    throw new Error(`GET /api/health/market-data: unexpected response (HTTP ${res.status})`);
  }
  return body as MarketDataHealth;
}

export function useMarketDataHealth() {
  return useQuery({ queryKey: keys.marketDataHealth(), queryFn: fetchMarketDataHealth });
}
