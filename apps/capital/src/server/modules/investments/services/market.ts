import type { DbClient } from "@capital/server/lib/prisma";
import type { AllocationClass, AssetClass } from "@/generated/prisma";
import { env } from "@/env";
import { allocationClassOf, holdingAllocationClass } from "../lib/allocation-class";
import { fetchQuotes, searchAssets, type Quote, type QuoteSource } from "../lib/quotes";

async function baseCurrency(userId: string, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  return user?.baseCurrency ?? "BRL";
}

/**
 * Current quotes for `tickers` (GET /v2/quotes). A ticker the user holds is
 * priced the way the price refresh prices that holding (its asset class
 * and, for crypto, its currency); any other is routed by its shape, crypto
 * in the user's base currency.
 */
export async function quotesFor(userId: string, tickers: string[], db: DbClient) {
  const wanted = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const [holdings, base] = await Promise.all([
    db.investmentHolding.findMany({
      where: { account: { userId }, ticker: { in: wanted, mode: "insensitive" } },
      select: { ticker: true, assetClass: true, currency: true, isActive: true },
      orderBy: { isActive: "desc" },
    }),
    baseCurrency(userId, db),
  ]);
  const held = new Map<string, { assetClass: AssetClass; currency: string }>();
  for (const h of holdings) if (h.ticker && !held.has(h.ticker.toUpperCase())) held.set(h.ticker.toUpperCase(), h);
  const found = await fetchQuotes(
    wanted.map((ticker) => ({ ticker, assetClass: held.get(ticker)?.assetClass ?? null, currency: held.get(ticker)?.currency ?? base })),
    { brapiToken: env.BRAPI_TOKEN, cryptoCurrency: base }
  );
  const quotes: Quote[] = wanted.filter((t) => found[t]).map((t) => found[t]);
  return { quotes, missing: wanted.filter((t) => !found[t]) };
}

export interface AssetSearchItem {
  ticker: string | null;
  name: string;
  assetClass: AssetClass;
  allocationClass: AllocationClass;
  currency: string;
  price: number | null;
  priceAsOf: string | null;
  /** "holding" = one of the user's holdings (holdingId and its broker set). */
  source: "holding" | QuoteSource;
  holdingId: string | null;
  accountId: string | null;
  accountName: string | null;
}

/**
 * The operation dialog's asset picker (GET /v2/assets/search): the user's
 * holdings matching `q` by ticker or name first, then market results from
 * brapi, Yahoo and the supported coins (unless `remote` is false) for
 * tickers the user does not hold yet.
 */
export async function searchAssetsFor(userId: string, q: string, db: DbClient, opts: { limit?: number; remote?: boolean } = {}) {
  const query = q.trim();
  const limit = opts.limit ?? 8;
  const holdings = await db.investmentHolding.findMany({
    where: {
      account: { userId, archivedAt: null },
      OR: [{ ticker: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }],
    },
    include: { account: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { ticker: "asc" }, { name: "asc" }],
    take: limit,
  });
  const own: AssetSearchItem[] = holdings.map((h) => ({
    ticker: h.ticker,
    name: h.name,
    assetClass: h.assetClass,
    allocationClass: holdingAllocationClass(h),
    currency: h.currency,
    price: h.currentPrice,
    priceAsOf: h.lastPriceUpdate?.toISOString() ?? null,
    source: "holding",
    holdingId: h.id,
    accountId: h.accountId,
    accountName: h.account.name,
  }));
  if (opts.remote === false || own.length >= limit) return { results: own.slice(0, limit) };

  const heldTickers = new Set(holdings.map((h) => h.ticker?.toUpperCase()).filter(Boolean));
  const remote = await searchAssets(query, { brapiToken: env.BRAPI_TOKEN, cryptoCurrency: await baseCurrency(userId, db), limit });
  const market: AssetSearchItem[] = remote
    .filter((r) => !heldTickers.has(r.ticker))
    .map((r) => ({
      ticker: r.ticker,
      name: r.name,
      assetClass: r.assetClass,
      allocationClass: allocationClassOf(r.assetClass, r.currency),
      currency: r.currency,
      price: r.price,
      priceAsOf: null,
      source: r.source,
      holdingId: null,
      accountId: null,
      accountName: null,
    }));
  return { results: [...own, ...market].slice(0, limit) };
}
