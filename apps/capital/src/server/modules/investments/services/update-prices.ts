import type { AssetClass } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { closeReadyAt, okPriceForExpectedSession, type Market } from "@capital/server/modules/market-data/lib/calendar";
import { resolveAsset, type ResolveAssetResult } from "@capital/server/modules/market-data/services/resolve-asset";
import { runStage } from "@capital/server/lib/cron";
import { syncRunResult } from "@capital/server/modules/market-data/lib/sync-run-result";
import { syncPrices } from "@capital/server/modules/market-data/services/sync-prices";
import { ALPHA_VANTAGE_SOURCE } from "@capital/server/modules/market-data/providers/alpha-vantage";
import { quoteSourceFor } from "../lib/quotes";

/** International names a single "Atualizar cotações" click may ask Alpha Vantage for. Three calls at the 13s pace stay inside a minute. */
export const MANUAL_ALPHA_VANTAGE_LIMIT = 3;

/**
 * Links a holding that isn't linked to an Asset yet (createHolding/
 * updateHolding don't call resolveAsset themselves), so a holding created
 * since the last backfill run — or ever, since nothing else does this —
 * still ends up auto-priced: linked here today, priced by the next
 * sync-prices run (daily, or right away when the caller is
 * refreshPricesLive). Returns resolveAsset's own answer, so a caller can tell
 * "nothing prices this" from "this holding's currency isn't the market's".
 */
async function linkHolding(db: DbClient, h: { id: string; ticker: string; assetClass: AssetClass; currency: string }): Promise<ResolveAssetResult> {
  const resolved = await resolveAsset(db, { ticker: h.ticker, assetClass: h.assetClass, currency: h.currency });
  if (resolved.linked) await db.investmentHolding.update({ where: { id: h.id }, data: { assetId: resolved.assetId, priceSource: "auto" } });
  return resolved;
}

/**
 * What InvestmentHolding.lastPriceUpdate gets: the quote's own instant when
 * the provider gave one, else the moment that session's close counts as
 * available — never midnight UTC of the trading date, which reads as the
 * previous evening in São Paulo and made every close look a day older.
 */
export function priceInstant(price: { date: Date; asOf: Date | null }, market: string): Date {
  if (price.asOf) return price.asOf;
  return closeReadyAt(market as Market, price.date.toISOString().slice(0, 10));
}

/** Why a holding did not get a fresh price this run. */
export type PriceUpdateReason = "no_ticker" | "no_source" | "currency_mismatch" | "write_failed" | "no_price_cached";

export interface HoldingPriceIssue {
  holdingId: string;
  ticker: string | null;
  reason: PriceUpdateReason;
  /** currency_mismatch only: the linked Asset's own currency (so this never gets applied in the wrong currency). */
  quotedCurrency?: string;
}

export interface PriceUpdateResult {
  totalHoldings: number;
  updated: number;
  /** Holdings whose price could not be written. */
  failed: number;
  /** Tickers with no usable cached price. */
  missing: string[];
  bySource: Record<string, number>;
  /** One entry per holding that did not get a fresh price this run, with why. */
  issues: HoldingPriceIssue[];
  /** The newest quote instant (see priceInstant) among the prices actually applied, in ISO; null if none were. */
  latestQuoteAt: string | null;
}

/**
 * Refreshes every active holding's cached price (currentPrice,
 * lastPriceUpdate) from AssetPrice — no network call, testable by a fetch
 * count of zero. This is the daily cron's job now; sync-prices.ts is what
 * actually talks to a provider and writes AssetPrice, on its own schedule
 * or on demand from POST /v2/holdings/refresh-prices (see that route,
 * which calls sync-prices itself and then this function, so the button
 * still ends up fetching live).
 *
 * A holding with no ticker or whose class has no automatic source
 * (fixed_income, savings) is reported the same way F0 did
 * (no_ticker/no_source). A priceable holding not linked to an Asset yet
 * gets linked right here (see linkHolding above) — it still won't have a
 * price today, so it's "no_price_cached" like one that's linked but
 * sync-prices hasn't priced yet, but tomorrow's sync-prices run will pick
 * it up without anyone having to press "Atualizar cotações" or rerun the
 * backfill script. This reason replaces F0's four live-fetch failure
 * reasons; those now live in SyncPricesResult.issues, from sync-prices's
 * own IntegrationRun.
 */
export async function updateAllPrices(db: DbClient, opts: { userId?: string } = {}): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = { totalHoldings: 0, updated: 0, failed: 0, missing: [], bySource: {}, issues: [], latestQuoteAt: null };

  const holdings = await db.investmentHolding.findMany({
    where: { isActive: true, ...(opts.userId && { account: { userId: opts.userId } }) },
    select: {
      id: true,
      ticker: true,
      assetClass: true,
      currency: true,
      asset: { select: { currency: true, market: true, prices: { where: { status: "ok" }, orderBy: { date: "desc" }, take: 1 } } },
    },
  });
  result.totalHoldings = holdings.length;
  if (!holdings.length) return result;

  let latestQuoteAt: Date | null = null;
  const updates: Promise<unknown>[] = [];
  for (const h of holdings) {
    const ticker = h.ticker?.trim().toUpperCase() ?? null;
    if (!ticker) {
      result.issues.push({ holdingId: h.id, ticker: null, reason: "no_ticker" });
      continue;
    }
    if (!quoteSourceFor(ticker, h.assetClass)) {
      result.issues.push({ holdingId: h.id, ticker, reason: "no_source" });
      continue;
    }
    const price = h.asset?.prices[0];
    if (!h.asset || !price) {
      if (!h.asset) {
        const linked = await linkHolding(db, { id: h.id, ticker, assetClass: h.assetClass, currency: h.currency });
        if (!linked.linked && linked.reason === "currency_mismatch") {
          result.issues.push({ holdingId: h.id, ticker, reason: "currency_mismatch", quotedCurrency: linked.marketCurrency });
          continue;
        }
      }
      result.missing.push(ticker);
      result.issues.push({ holdingId: h.id, ticker, reason: "no_price_cached" });
      continue;
    }
    if (h.asset.currency.toUpperCase() !== h.currency.toUpperCase()) {
      result.issues.push({ holdingId: h.id, ticker, reason: "currency_mismatch", quotedCurrency: h.asset.currency });
      continue;
    }
    result.bySource[price.source] = (result.bySource[price.source] ?? 0) + 1;
    const close = Number(price.close.toString());
    const at = priceInstant(price, h.asset.market);
    if (!latestQuoteAt || at > latestQuoteAt) latestQuoteAt = at;
    updates.push(
      db.investmentHolding
        .update({ where: { id: h.id }, data: { currentPrice: close, lastPriceUpdate: at } })
        .then(() => {
          result.updated++;
        })
        .catch((err) => {
          console.error(`[PriceUpdate] Failed to update holding ${h.id}:`, err);
          result.failed++;
          result.issues.push({ holdingId: h.id, ticker, reason: "write_failed" });
        }),
    );
  }
  await Promise.all(updates);
  result.latestQuoteAt = latestQuoteAt ? latestQuoteAt.toISOString() : null;
  return result;
}

/**
 * What "Atualizar cotações" on the Carteira screen calls (POST
 * /v2/holdings/refresh-prices): links any of the user's own holdings that
 * aren't linked to an Asset yet (createHolding/updateHolding don't call
 * resolveAsset themselves — see resolve-asset.ts — so this is also what
 * catches up a holding created since the last backfill run), fetches live
 * prices for every linked asset right now — writing AssetPrice, so other
 * users holding the same asset benefit too — then refreshes this user's
 * holdings from that fresh cache. Same response shape as updateAllPrices,
 * so the button's experience doesn't change; only the daily cron skips the
 * live fetch and the linking.
 */
export async function refreshPricesLive(db: DbClient, userId: string): Promise<PriceUpdateResult> {
  const holdings = await db.investmentHolding.findMany({
    where: { isActive: true, account: { userId } },
    select: { id: true, ticker: true, assetClass: true, currency: true, assetId: true },
  });

  const assetIds = new Set<string>();
  for (const h of holdings) {
    const ticker = h.ticker?.trim().toUpperCase();
    let assetId = h.assetId;
    if (!assetId && ticker) {
      const linked = await linkHolding(db, { id: h.id, ticker, assetClass: h.assetClass, currency: h.currency });
      if (linked.linked) assetId = linked.assetId;
    }
    if (assetId) assetIds.add(assetId);
  }

  // B3 and crypto are always fetched live. Alpha Vantage is only asked for a
  // name whose close is missing, oldest first, and only a few of them: the
  // free tier is 25/day and the click has to answer inside a minute. A name
  // left out keeps the cached close (updateAllPrices below) and is not a miss.
  if (assetIds.size) {
    const now = new Date();
    const assets = await db.asset.findMany({
      where: { id: { in: [...assetIds] } },
      include: {
        sourceRefs: { select: { source: true } },
        prices: { where: { status: "ok" }, orderBy: { date: "desc" }, take: 10, select: { date: true, status: true, kind: true, asOf: true } },
      },
    });
    const live: string[] = [];
    const staleAv: { id: string; date: number }[] = [];
    for (const asset of assets) {
      const hasAv = asset.sourceRefs.some((r) => r.source === ALPHA_VANTAGE_SOURCE);
      const hasOther = asset.sourceRefs.some((r) => r.source !== ALPHA_VANTAGE_SOURCE);
      if (hasOther || !hasAv) live.push(asset.id);
      if (!hasAv || okPriceForExpectedSession(asset.market, asset.prices, now)) continue;
      staleAv.push({ id: asset.id, date: asset.prices[0]?.date.getTime() ?? 0 });
    }
    staleAv.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const ids = [...live];
    let avOnly = 0;
    for (const row of staleAv) {
      if (ids.includes(row.id)) continue;
      if (avOnly >= MANUAL_ALPHA_VANTAGE_LIMIT) break;
      ids.push(row.id);
      avOnly++;
    }
    if (ids.length) {
      await runStage(
        "sync-prices",
        async () => syncRunResult(await syncPrices(db, { assetIds: ids, alphaVantageLimit: MANUAL_ALPHA_VANTAGE_LIMIT })),
        { trigger: "manual" },
      );
    }
  }
  return updateAllPrices(db, { userId });
}
