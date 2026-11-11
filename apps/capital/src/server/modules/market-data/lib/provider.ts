import type { AssetClass } from "@/generated/prisma";
import type { FetchOutcome } from "@capital/server/lib/http";

/**
 * The contract every market-data source implements (brapi, Yahoo, CoinGecko
 * today; a B3 bulk file or anything else later). The domain — sync-prices,
 * resolve-asset, the asset search — only ever calls through this, via
 * registry.ts's chainFor(); a vendor name shows up nowhere outside
 * providers/*.ts and the `source` column on AssetSourceRef/AssetPrice.
 * Adding or swapping a source is one adapter file, one line in registry.ts's
 * provider lists, and one fixture — never a migration, never a change here.
 *
 * Nothing in this contract may throw. A provider that can't answer returns a
 * FetchOutcome describing why (not_found, unauthorized, rate_limited, provider_down,
 * schema_changed) so the registry's chain can fail over and sync-prices can
 * tell "the market didn't move" from "the source is broken".
 */

export interface PricePoint {
  /** ISO yyyy-mm-dd, the close's trading date on the provider's own calendar. What AssetPrice stores. */
  date: string;
  close: number;
  currency: string;
  /** Full ISO instant, when the provider's quote has sub-day precision (a live "today" quote, say) — beyond what AssetPrice keeps, read only by callers (quotes.ts) that still show an exact time. */
  asOf?: string;
}

export interface InstrumentMatch {
  /** The id to store on AssetSourceRef.externalId if this match is picked. */
  externalId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  price?: number | null;
}

export type MarketDataCapability = "prices" | "bulk-prices" | "lookup";

export interface MarketDataProvider {
  /** Stable id, stored verbatim as AssetSourceRef.source / AssetPrice.source. Never shown to a user. */
  readonly id: string;
  readonly capabilities: readonly MarketDataCapability[];
  /** Asset classes this provider can price. The registry never offers it outside these. */
  readonly markets: readonly AssetClass[];

  /** Closes for one externalId within `range` (inclusive), oldest first. A provider with no history just returns today's in a single-element array. */
  fetchPrices?(externalId: string, range: { from: string; to: string }): Promise<FetchOutcome<PricePoint[]>>;

  /** One call prices every instrument the provider covers for `date` (e.g. a bulk EOD file) — see sync-prices.ts for why this beats one request per asset when a provider has it. */
  fetchAllPrices?(date: string): Promise<FetchOutcome<Map<string, PricePoint>>>;

  /** Instruments matching a free-text query, for asset search and resolve-asset. */
  lookup?(query: string): Promise<FetchOutcome<InstrumentMatch[]>>;
}
