import { fetchJson } from "@capital/server/lib/http";
import type { FetchOutcome } from "@capital/server/lib/http";
import { isoOrNull } from "../lib/time";
import type { InstrumentMatch, MarketDataProvider, PricePoint } from "../lib/provider";

/**
 * CoinGecko — crypto, by the ids in CRYPTO_SYMBOL_TO_COINGECKO_ID (the coins
 * the registry/sync-prices can keep priced today; anything else is "not
 * found" rather than a guess). The externalId stored on AssetSourceRef is
 * the CoinGecko id (e.g. "bitcoin"), resolved once by resolve-asset.ts.
 */

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";

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
export const CRYPTO_NAMES: Record<string, string> = {
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

interface CoinGeckoPriceBody {
  [coinId: string]: { [currency: string]: number } & { last_updated_at?: number };
}

function parseCoinGeckoBody(body: unknown): CoinGeckoPriceBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("expected an object keyed by coin id");
  return body as CoinGeckoPriceBody;
}

/**
 * CoinGecko has no per-currency fetch in this contract — `externalId` here
 * is "<coingeckoId>:<currency>" (set by resolve-asset.ts on AssetSourceRef,
 * one ref per currency the coin is held in), since the same coin can be
 * priced in BRL for one holding and USD for another.
 */
async function fetchPrices(externalId: string): Promise<FetchOutcome<PricePoint[]>> {
  const [coinId, currency] = externalId.split(":");
  if (!coinId || !currency) return { outcome: "not_found", status: 200 };
  const vs = currency.toLowerCase();
  const result = await fetchJson(`${COINGECKO_API}?ids=${coinId}&vs_currencies=${vs}&include_last_updated_at=true`, {
    label: `CoinGecko ${coinId}`,
    parse: parseCoinGeckoBody,
  });
  if (result.outcome !== "ok") return result;
  const row = result.data[coinId];
  const price = row?.[vs];
  if (typeof price !== "number" || price <= 0) return { outcome: "not_found", status: result.status };
  const asOf = isoOrNull(row.last_updated_at);
  const point: PricePoint = { date: (asOf ?? new Date().toISOString()).slice(0, 10), close: price, currency: currency.toUpperCase(), asOf: asOf ?? undefined };
  return { outcome: "ok", status: result.status, data: [point] };
}

/** Matches by symbol or name against the fixed supported-coin map; always USD (resolve-asset re-keys per holding currency). One batched request for every match, same as the pre-F1 searchAssets did. */
async function lookup(query: string): Promise<FetchOutcome<InstrumentMatch[]>> {
  const upper = query.trim().toUpperCase();
  if (upper.length < 2) return { outcome: "ok", status: 200, data: [] };
  const symbols = Object.keys(CRYPTO_SYMBOL_TO_COINGECKO_ID).filter(
    (s) => s.startsWith(upper) || CRYPTO_NAMES[s]!.toUpperCase().includes(upper) || CRYPTO_SYMBOL_TO_COINGECKO_ID[s]!.toUpperCase().includes(upper),
  );
  if (!symbols.length) return { outcome: "ok", status: 200, data: [] };
  const ids = symbols.map((s) => CRYPTO_SYMBOL_TO_COINGECKO_ID[s]).join(",");
  const result = await fetchJson(`${COINGECKO_API}?ids=${ids}&vs_currencies=usd`, { label: "CoinGecko search", parse: parseCoinGeckoBody });
  if (result.outcome !== "ok") return result;
  const matches = symbols.map((symbol): InstrumentMatch => {
    const coinId = CRYPTO_SYMBOL_TO_COINGECKO_ID[symbol]!;
    const price = result.data[coinId]?.usd;
    return { externalId: `${coinId}:usd`, symbol, name: CRYPTO_NAMES[symbol]!, assetClass: "crypto", currency: "USD", price: typeof price === "number" && price > 0 ? price : null };
  });
  return { outcome: "ok", status: result.status, data: matches };
}

export const coingeckoProvider: MarketDataProvider = {
  id: "coingecko",
  capabilities: ["prices", "lookup"],
  markets: ["crypto"],
  fetchPrices,
  lookup,
};
