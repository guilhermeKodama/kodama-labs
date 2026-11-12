import { fetchJson } from "@capital/server/lib/http";
import { env } from "@/env";
import { isoOrNull } from "../lib/time";
import type { InstrumentMatch, MarketDataProvider, PricePoint } from "../lib/provider";

/**
 * brapi.dev — B3 (stocks, FIIs, ETFs, BDRs). Free plan: one ticker per
 * request (comma-joining several is a paid-plan feature that silently
 * returns just the first on Free), one request per lookup result.
 */

const BRAPI_API = "https://brapi.dev/api";

const withToken = (url: string) => (env.BRAPI_TOKEN ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(env.BRAPI_TOKEN)}` : url);

interface BrapiQuoteResult {
  symbol?: unknown;
  regularMarketPrice?: unknown;
  currency?: unknown;
  regularMarketTime?: unknown;
}

function parseBrapiQuoteBody(body: unknown): { results?: BrapiQuoteResult[] } {
  const results = (body as { results?: unknown } | null)?.results;
  if (results !== undefined && !Array.isArray(results)) throw new Error("results is not an array");
  return { results: results as BrapiQuoteResult[] | undefined };
}

async function fetchPrices(externalId: string): ReturnType<NonNullable<MarketDataProvider["fetchPrices"]>> {
  const result = await fetchJson(withToken(`${BRAPI_API}/quote/${encodeURIComponent(externalId)}`), {
    label: `brapi.dev ${externalId}`,
    parse: parseBrapiQuoteBody,
  });
  if (result.outcome !== "ok") return result;
  const row = result.data.results?.[0];
  const symbol = typeof row?.symbol === "string" ? row.symbol.toUpperCase() : null;
  const price = typeof row?.regularMarketPrice === "number" ? row.regularMarketPrice : null;
  // A quote for a different symbol than asked (or none at all) is "not found", never mis-keyed under the wrong ticker.
  if (!row || !symbol || !price || symbol !== externalId.toUpperCase()) return { outcome: "not_found", status: result.status };
  const asOf = isoOrNull(row.regularMarketTime);
  const point: PricePoint = { date: (asOf ?? new Date().toISOString()).slice(0, 10), close: price, currency: typeof row.currency === "string" ? row.currency.toUpperCase() : "BRL", asOf: asOf ?? undefined };
  return { outcome: "ok", status: result.status, data: [point] };
}

interface BrapiListItem {
  stock?: string;
  name?: string;
  close?: number | null;
  type?: string;
}

const ETF_NAME = /\b(ETF|ISHARES|[IÍ]NDICE|IT NOW|TREND|HASHDEX)\b/i;

/** brapi's stock / fund / bdr, mapped to an asset class (a "fund" is an ETF when its name says so, else a FII). */
export function brapiAssetClass(type: string | undefined, name: string): InstrumentMatch["assetClass"] {
  if (type === "bdr") return "bdr";
  if (type === "fund") return ETF_NAME.test(name) ? "etf" : "fii";
  return "stocks";
}

async function lookup(query: string): ReturnType<NonNullable<MarketDataProvider["lookup"]>> {
  const result = await fetchJson<{ stocks?: BrapiListItem[] }>(withToken(`${BRAPI_API}/quote/list?search=${encodeURIComponent(query)}&limit=8`), {
    label: "brapi.dev search",
    retries: 1,
  });
  if (result.outcome !== "ok") return result;
  const matches = (result.data.stocks ?? [])
    .filter((s): s is BrapiListItem & { stock: string } => !!s.stock)
    .map((s): InstrumentMatch => ({
      externalId: s.stock.toUpperCase(),
      symbol: s.stock.toUpperCase(),
      name: s.name ?? s.stock,
      assetClass: brapiAssetClass(s.type, s.name ?? ""),
      currency: "BRL",
      price: typeof s.close === "number" && s.close > 0 ? s.close : null,
    }));
  return { outcome: "ok", status: result.status, data: matches };
}

export const brapiProvider: MarketDataProvider = {
  id: "brapi",
  capabilities: ["prices", "lookup"],
  markets: ["stocks", "fii", "bdr", "etf"],
  fetchPrices,
  lookup,
};
