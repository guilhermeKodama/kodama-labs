import type { Asset, AssetClass, AssetSourceRef, Prisma, PrismaClient } from "@/generated/prisma";
import { mapWithConcurrency } from "@capital/server/lib/concurrency";
import { acceptPrice } from "../lib/accept-price";
import type { PricePoint } from "../lib/provider";
import { chainFor } from "../lib/registry";

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
 * Per asset class, a bulk leader (fetchAllPrices — none of brapi/Yahoo/
 * CoinGecko has one yet; this is the hook a future COTAHIST-style source
 * would plug into) prices every asset of that class in one call; anything
 * it misses, or any class with no bulk leader, falls through to the normal
 * per-asset chain walk, trying each provider the asset has a source ref
 * for until one succeeds.
 *
 * Every accepted or suspect point is written; a rejected one (wrong
 * currency, bad date, non-positive — see accept-price.ts) is not written
 * at all and shows up only as an issue, same as a provider that came back
 * not_found or down.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type AssetWithRefs = Asset & { sourceRefs: AssetSourceRef[] };

export interface SyncPricesScope {
  /** Limits the sync to these Asset ids. Omitted syncs every active Asset with a source ref. */
  assetIds?: string[];
}

export type SyncIssueOutcome = "not_found" | "rate_limited" | "provider_down" | "schema_changed" | "rejected" | "no_source";

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type WriteOutcome = { status: "ok" | "suspect"; date: Date } | { status: "rejected"; reason: string };

/** acceptPrice()'s verdict, then the write it implies: an ok/suspect point is upserted; a fresh ok that lands near a prior "suspect" row promotes that row to "ok" too (the jump was real, confirmed a day late) — see accept-price.ts. A rejected point is never written. */
async function writePoint(db: Db, asset: AssetWithRefs, source: string, point: PricePoint): Promise<WriteOutcome> {
  const previous = await db.assetPrice.findFirst({ where: { assetId: asset.id }, orderBy: { date: "desc" } });
  const verdict = acceptPrice({
    point,
    asset: { currency: asset.currency, assetClass: asset.assetClass },
    previous: previous ? { close: Number(previous.close.toString()), status: previous.status } : null,
  });
  if (verdict.status === "rejected") return { status: "rejected", reason: verdict.reason };

  const date = new Date(`${point.date}T00:00:00Z`);
  await db.assetPrice.upsert({
    where: { assetId_date: { assetId: asset.id, date } },
    create: { assetId: asset.id, date, close: point.close, source, status: verdict.status },
    update: { close: point.close, source, status: verdict.status },
  });
  if (verdict.status === "ok" && previous?.status === "suspect" && previous.date.getTime() !== date.getTime()) {
    await db.assetPrice.update({ where: { id: previous.id }, data: { status: "ok" } });
  }
  return { status: verdict.status, date };
}

type AssetOutcome = { status: "ok" | "suspect"; source: string; date: Date } | { status: "missing"; issue: SyncPricesIssue };

async function syncOneAsset(db: Db, asset: AssetWithRefs, range: { from: string; to: string }): Promise<AssetOutcome> {
  const refsBySource = new Map(asset.sourceRefs.map((r) => [r.source, r.externalId]));
  let lastIssue: SyncPricesIssue | undefined;
  for (const provider of chainFor(asset.assetClass)) {
    if (!provider.fetchPrices) continue;
    const externalId = refsBySource.get(provider.id);
    if (!externalId) continue;
    const result = await provider.fetchPrices(externalId, range);
    if (result.outcome !== "ok") {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: result.outcome, source: provider.id, error: "error" in result ? result.error : undefined };
      continue;
    }
    const point = result.data[0];
    if (!point) {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: "not_found", source: provider.id };
      continue;
    }
    const written = await writePoint(db, asset, provider.id, point);
    if (written.status === "rejected") {
      lastIssue = { assetId: asset.id, symbol: asset.symbol, outcome: "rejected", source: provider.id, error: written.reason };
      continue;
    }
    return { status: written.status, source: provider.id, date: written.date };
  }
  return { status: "missing", issue: lastIssue ?? { assetId: asset.id, symbol: asset.symbol, outcome: "no_source", source: null } };
}

function record(result: SyncPricesResult, outcome: AssetOutcome): void {
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
    include: { sourceRefs: true },
  })) as AssetWithRefs[];

  const result: SyncPricesResult = { requested: assets.length, priced: 0, suspect: 0, missing: 0, bySource: {}, providerLatestDate: null, issues: [] };
  if (!assets.length) return result;

  const range = { from: todayIso(), to: todayIso() };
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
      const written = await writePoint(db, asset, leader.id, point);
      record(result, written.status === "rejected" ? { status: "missing", issue: { assetId: asset.id, symbol: asset.symbol, outcome: "rejected", source: leader.id, error: written.reason } } : { status: written.status, source: leader.id, date: written.date });
    }
  }

  const outcomes = await mapWithConcurrency(remaining, CONCURRENCY, (asset) => syncOneAsset(db, asset, range));
  for (const outcome of outcomes) record(result, outcome);

  return result;
}
