import type { AssetClass } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { resolveAsset } from "@capital/server/modules/market-data/services/resolve-asset";
import { syncPrices } from "@capital/server/modules/market-data/services/sync-prices";
import { quoteSourceFor } from "../lib/quotes";

/**
 * Links a holding that isn't linked to an Asset yet (createHolding/
 * updateHolding don't call resolveAsset themselves), so a holding created
 * since the last backfill run — or ever, since nothing else does this —
 * still ends up auto-priced: linked here today, priced by the next
 * sync-prices run (daily, or right away when the caller is
 * refreshPricesLive). Returns the Asset id on success, null when nothing
 * matches (resolveAsset's own "no_ticker"/"no_source"/"unmatched").
 */
async function linkHolding(db: DbClient, h: { id: string; ticker: string; assetClass: AssetClass; currency: string }): Promise<string | null> {
  const resolved = await resolveAsset(db, { ticker: h.ticker, assetClass: h.assetClass, currency: h.currency });
  if (!resolved.linked) return null;
  await db.investmentHolding.update({ where: { id: h.id }, data: { assetId: resolved.assetId, priceSource: "auto" } });
  return resolved.assetId;
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
  /** The newest AssetPrice date among the prices actually applied, in ISO; null if none were. */
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
      asset: { select: { currency: true, prices: { where: { status: "ok" }, orderBy: { date: "desc" }, take: 1 } } },
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
      if (!h.asset) await linkHolding(db, { id: h.id, ticker, assetClass: h.assetClass, currency: h.currency });
      result.missing.push(ticker);
      result.issues.push({ holdingId: h.id, ticker, reason: "no_price_cached" });
      continue;
    }
    if (h.asset.currency.toUpperCase() !== h.currency.toUpperCase()) {
      result.issues.push({ holdingId: h.id, ticker, reason: "currency_mismatch", quotedCurrency: h.asset.currency });
      continue;
    }
    result.bySource[price.source] = (result.bySource[price.source] ?? 0) + 1;
    if (!latestQuoteAt || price.date > latestQuoteAt) latestQuoteAt = price.date;
    const close = Number(price.close.toString());
    const date = price.date;
    updates.push(
      db.investmentHolding
        .update({ where: { id: h.id }, data: { currentPrice: close, lastPriceUpdate: date } })
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
    const assetId = h.assetId ?? (ticker ? await linkHolding(db, { id: h.id, ticker, assetClass: h.assetClass, currency: h.currency }) : null);
    if (assetId) assetIds.add(assetId);
  }

  if (assetIds.size) await syncPrices(db, { assetIds: [...assetIds] });
  return updateAllPrices(db, { userId });
}
