import type { AssetClass } from "@/generated/prisma";
import { env } from "@/env";
import { brapiProvider } from "../providers/brapi";
import { coingeckoProvider } from "../providers/coingecko";
import { yahooProvider } from "../providers/yahoo";
import type { MarketDataProvider } from "./provider";

/**
 * The default chain, in priority order, and the two env overrides
 * (MARKET_DATA_CHAIN / MARKET_DATA_DISABLED) that reorder or drop a source
 * with one line and a restart — no deploy, no migration. This file is the
 * entire cost of trading one source for another; see provider.ts.
 *
 * brapi leads for B3 only when BRAPI_TOKEN is set: without one, brapi.dev
 * refuses all but a handful of demo tickers (401), so Yahoo's "<ticker>.SA"
 * goes first and brapi stays in the chain as the fallback. brapi stays at
 * all because Yahoo is unofficial (no SLA, a scraping library) and because
 * the B3 asset search already comes from brapi's list.
 */
const WITH_BRAPI_TOKEN: readonly MarketDataProvider[] = [brapiProvider, yahooProvider, coingeckoProvider];
const WITHOUT_BRAPI_TOKEN: readonly MarketDataProvider[] = [yahooProvider, brapiProvider, coingeckoProvider];

/** Whether brapi has a credential. Read by the health panel ("brapi sem token") as well as the default order. */
export function brapiHasToken(): boolean {
  return !!env.BRAPI_TOKEN?.trim();
}

function parseIdList(value: string | undefined): string[] | null {
  if (!value) return null;
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

/** Every provider, after MARKET_DATA_DISABLED removes some and MARKET_DATA_CHAIN reorders the rest. An id MARKET_DATA_CHAIN doesn't recognize is ignored, not an error. */
export function activeProviders(): MarketDataProvider[] {
  const disabled = new Set(parseIdList(env.MARKET_DATA_DISABLED) ?? []);
  const enabled = (brapiHasToken() ? WITH_BRAPI_TOKEN : WITHOUT_BRAPI_TOKEN).filter((p) => !disabled.has(p.id));
  const order = parseIdList(env.MARKET_DATA_CHAIN);
  if (!order) return enabled;
  const byId = new Map(enabled.map((p) => [p.id, p] as const));
  const ordered = order.map((id) => byId.get(id)).filter((p): p is MarketDataProvider => !!p);
  const rest = enabled.filter((p) => !order.includes(p.id));
  return [...ordered, ...rest];
}

/** The chain for one asset class, in priority order — the only thing sync-prices/resolve-asset/quotes.ts call to find a source. Empty for a class with no automatic source (fixed_income, savings). */
export function chainFor(assetClass: AssetClass): MarketDataProvider[] {
  return activeProviders().filter((p) => p.markets.includes(assetClass));
}

/** The provider the health panel shows as a class's "fonte ativa" — the chain's first entry, or null. Pure read of the registry; never hits the network. */
export function activeProviderFor(assetClass: AssetClass): MarketDataProvider | null {
  return chainFor(assetClass)[0] ?? null;
}
