import type { Asset, AssetClass, AssetSourceRef, Prisma, PrismaClient } from "@/generated/prisma";
import { mapWithConcurrency } from "@capital/server/lib/concurrency";
import { acceptPrice } from "../lib/accept-price";
import { okPriceForExpectedSession, quoteKind, type Market } from "../lib/calendar";
import type { PricePoint } from "../lib/provider";
import { chainFor } from "../lib/registry";
import { ALPHA_VANTAGE_SOURCE, applyAlphaVantageCurrency } from "../providers/alpha-vantage";

/**
 * Prices every Asset the scope covers, writing one AssetPrice row per asset
 * per day. Two callers, one implementation:
 *
 * - the daily cron (no scope): every active Asset with at least one source
 *   ref;
 * - "Atualizar cotações" on the Carteira screen ({ assetIds }): just the
 *   assets behind the user's own holdings, fetched live right then (see
 *   update-prices.ts, which reads this instead of calling a provider
 *   itself).
 *
 * Per asset class, a bulk leader (fetchAllPrices — none of brapi/Alpha
 * Vantage/CoinGecko has one yet; this is the hook a future COTAHIST-style source
 * would plug into) prices every asset of that class in one call; anything
 * it misses, or any class with no bulk leader, falls through to the normal
 * per-asset chain walk, trying each provider the asset has a source ref
 * for until one succeeds.
 *
 * Every accepted or suspect point is written; a rejected one (wrong
 * currency, bad date, non-positive — see accept-price.ts) is not written
 * at all and shows up only as an issue, same as a provider that came back
 * not_found or down.
 *
 * Alpha Vantage is skipped when the asset already has an ok close for the
 * expected session, and a manual refresh can cap how many of those calls
 * this request makes (`alphaVantageLimit`). A name left out by that cap is
 * not a failure: the cached close is what the holding still shows.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type CachedPrice = { date: Date; status: string; kind: string; asOf: Date | null };
type AssetWithRefs = Asset & { sourceRefs: AssetSourceRef[]; prices: CachedPrice[] };

export interface SyncPricesScope {
  /** Limits the sync to these Asset ids. Omitted syncs every active Asset with a source ref. */
  assetIds?: string[];
  /** The clock: decides whether a quote is the day's close or intraday. Tests pin it. */
  now?: Date;
  /**
   * How many Alpha Vantage calls this run may start. The manual refresh
   * sets it so the HTTP request returns inside a minute. Omitted, the run
   * asks for every stale name and the daily counter is the only cap.
   */
  alphaVantageLimit?: number;
}

export type SyncIssueOutcome = "not_found" | "unauthorized" | "rate_limited" | "provider_down" | "schema_changed" | "rejected" | "no_source";

export interface SyncPricesIssue {
  assetId: string;
  symbol: string;
  outcome: SyncIssueOutcome;
  source: string | null;
  error?: string;
}

export interface SyncPricesResult {
  requested: number;
  priced: number;
  suspect: number;
  missing: number;
  bySource: Record<string, number>;
  providerLatestDate: Date | null;
  issues: SyncPricesIssue[];
}

/** A handful of providers answering in parallel is plenty; stays well under each one's own per-minute limit (brapi's Free plan in particular). */
const CONCURRENCY = 6;


type WriteOutcome = { status: "ok" | "suspect"; date: Date } | { status: "rejected"; reason: string };

/**
 * acceptPrice()'s verdict, then the write it implies: an ok/suspect point is
 * upserted; a fresh ok that lands near a prior "suspect" row promotes that
 * row to "ok" too (the jump was real, confirmed a day late) — see
 * accept-price.ts. A rejected point is never written.
 *
 * The point is judged against the newest row of an *earlier* date, never
 * the same day's: an intraday quote taken after a suspect close must not
 * "confirm" that close by being near it, and a re-sync of today must not
 * compare today with itself. The same day's row is just overwritten (the
 * close replaces an intraday quote; a later close replaces an earlier one).
 */
async function writePoint(db: Db, asset: AssetWithRefs, source: string, point: PricePoint, now: Date = new Date()): Promise<WriteOutcome> {
  const date = new Date(`${point.date}T00:00:00Z`);
  const previous = await db.assetPrice.findFirst({ where: { assetId: asset.id, date: { lt: date } }, orderBy: { date: "desc" } });
  const verdict = acceptPrice({
    point,
    asset: { currency: asset.currency, assetClass: asset.assetClass },
    previous: previous ? { close: Number(previous.close.toString()), status: previous.status } : null,
    now,
  });
  if (verdict.status === "rejected") return { status: "rejected", reason: verdict.reason };

  const kind = quoteKind(asset.market as Market, point.date, now);
  const asOf = point.asOf ? new Date(point.asOf) : null;
  await db.assetPrice.upsert({
    where: { assetId_date: { assetId: asset.id, date } },
    create: { assetId: asset.id, date, close: point.close, source, status: verdict.status, kind, asOf },
    update: { close: point.close, source, status: verdict.status, kind, asOf },
  });
  if (verdict.status === "ok" && previous?.status === "suspect") {
    await db.assetPrice.update({ where: { id: previous.id }, data: { status: "ok" } });
  }
  return { status: verdict.status, date };
}

type AssetOutcome =
  | { status: "ok" | "suspect"; source: string; date: Date }
  | { status: "fresh"; date: Date }
  | { status: "deferred" }
  | { status: "missing"; issue: SyncPricesIssue };

interface AlphaVantageBudget {
  limit: number;
  n: number;
}

async function syncOneAsset(db: Db, asset: AssetWithRefs, range: { from: string; to: string }, now: Date, avBudget: AlphaVantageBudget | null): Promise<AssetOutcome> {
  const refsBySource = new Map(asset.sourceRefs.map((r) => [r.source, r.externalId]));
  let lastIssue: SyncPricesIssue | undefined;
  let lastFresh: Date | null = null;
  let deferred = false;
  for (const provider of chainFor(asset.assetClass)) {
    if (!provider.fetchPrices) continue;
    const externalId = refsBySource.get(provider.id);
    if (!externalId) continue;
    if (provider.id === ALPHA_VANTAGE_SOURCE) {
      const current = okPriceForExpectedSession(asset.market, asset.prices, now);
      if (current) {
        lastFresh = current.date;
        continue;
      }
      if (avBudget && avBudget.n >= avBudget.limit) {
        deferred = true;
        continue;
      }
      if (avBudget) avBudget.n += 1;
    }
    const result = await provider.fetchPrices(externalId, range);
    if (result.outcome !== "ok") {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: result.outcome, source: provider.id, error: "error" in result ? result.error : undefined };
      continue;
    }
    let point = result.data[0];
    if (!point) {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: "not_found", source: provider.id };
      continue;
    }
    if (provider.id === ALPHA_VANTAGE_SOURCE) {
      const priced = applyAlphaVantageCurrency(externalId, point, asset.currency);
      if (!priced) {
        lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: "rejected", source: provider.id, error: "moeda desconhecida" };
        continue;
      }
      point = priced;
    }
    const written = await writePoint(db, asset, provider.id, point, now);
    if (written.status === "rejected") {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: "rejected", source: provider.id, error: written.reason };
      continue;
    }
    return { status: written.status, source: provider.id, date: written.date };
  }
  if (lastFresh) return { status: "fresh", date: lastFresh };
  if (deferred && !lastIssue) return { status: "deferred" };
  return { status: "missing", issue: lastIssue ?? { assetId: asset.id, symbol: asset.symbol, outcome: "no_source", source: null } };
}

function record(result: SyncPricesResult, outcome: AssetOutcome): void {
  if (outcome.status === "deferred") {
    result.requested--;
    return;
  }
  if (outcome.status === "fresh") {
    result.priced++;
    if (!result.providerLatestDate || outcome.date > result.providerLatestDate) result.providerLatestDate = outcome.date;
    return;
  }
  if (outcome.status === "missing") {
    result.missing++;
    result.issues.push(outcome.issue);
    return;
  }
  result[outcome.status === "ok" ? "priced" : "suspect"]++;
  result.bySource[outcome.source] = (result.bySource[outcome.source] ?? 0) + 1;
  if (!result.providerLatestDate || outcome.date > result.providerLatestDate) result.providerLatestDate = outcome.date;
}

export async function syncPrices(db: Db, scope: SyncPricesScope = {}): Promise<SyncPricesResult> {
  const assets = (await db.asset.findMany({
    where: { isActive: true, ...(scope.assetIds ? { id: { in: scope.assetIds } } : {}) },
    include: { sourceRefs: true, prices: { where: { status: "ok" }, orderBy: { date: "desc" }, take: 10, select: { date: true, status: true, kind: true, asOf: true } } },
  })) as AssetWithRefs[];

  const result: SyncPricesResult = { requested: assets.length, priced: 0, suspect: 0, missing: 0, bySource: {}, providerLatestDate: null, issues: [] };
  if (!assets.length) return result;

  const now = scope.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const range = { from: today, to: today };
  const byClass = new Map<AssetClass, AssetWithRefs[]>();
  for (const asset of assets) byClass.set(asset.assetClass, [...(byClass.get(asset.assetClass) ?? []), asset]);

  const remaining: AssetWithRefs[] = [];
  for (const [assetClass, group] of byClass) {
    const leader = chainFor(assetClass)[0];
    if (!leader?.fetchAllPrices) {
      remaining.push(...group);
      continue;
    }
    const bulk = await leader.fetchAllPrices(range.to);
    if (bulk.outcome !== "ok") {
      // The bulk source is down: the rest of the chain still gets a shot per asset.
      remaining.push(...group);
      continue;
    }
    for (const asset of group) {
      const externalId = asset.sourceRefs.find((r) => r.source === leader.id)?.externalId;
      const point = externalId ? bulk.data.get(externalId) : undefined;
      if (!point) {
        remaining.push(asset);
        continue;
      }
      const written = await writePoint(db, asset, leader.id, point, now);
      record(result, written.status === "rejected" ? { status: "missing", issue: { assetId: asset.id, symbol: asset.symbol, outcome: "rejected", source: leader.id, error: written.reason } } : { status: written.status, source: leader.id, date: written.date });
    }
  }

  if (scope.alphaVantageLimit !== undefined) {
    remaining.sort((a, b) => (a.prices[0]?.date.getTime() ?? 0) - (b.prices[0]?.date.getTime() ?? 0));
  }
  const avBudget = scope.alphaVantageLimit === undefined ? null : { limit: scope.alphaVantageLimit, n: 0 };
  const outcomes = await mapWithConcurrency(remaining, CONCURRENCY, (asset) => syncOneAsset(db, asset, range, now, avBudget));
  for (const outcome of outcomes) record(result, outcome);

  return result;
}
