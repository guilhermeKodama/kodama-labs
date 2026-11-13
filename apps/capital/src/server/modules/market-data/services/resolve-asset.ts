import type { AssetClass, Prisma, PrismaClient } from "@/generated/prisma";
import type { Market } from "../lib/calendar";
import { isBrazilianTicker } from "../lib/ticker";
import { ALPHA_VANTAGE_SOURCE, alphaVantageExternalId } from "../providers/alpha-vantage";
import { CRYPTO_SYMBOL_TO_COINGECKO_ID } from "../providers/coingecko";

/**
 * Matches one holding's (ticker, assetClass, currency) to a global Asset,
 * creating it and its AssetSourceRef rows the first time. Called by
 * scripts/backfill-asset-links.ts for existing holdings, and by
 * refreshPricesLive (update-prices.ts) for any of the user's own holdings
 * that still aren't linked when "Atualizar cotações" is pressed — so a
 * holding created after the last backfill run still ends up auto-priced
 * the first time someone asks for a refresh, not only after a human reruns
 * the script. createHolding/updateHolding do not call it directly yet.
 *
 * Idempotent: resolving the same (ticker, market, currency) again finds the
 * Asset already created for it (the @@unique on Asset) and upserts the same
 * source refs, never a duplicate — even when the second holding gave the
 * same instrument a different class.
 *
 * Never links across currencies: a holding kept in another currency than the
 * one its market quotes in (a "PETR4" holding in USD) stays unlinked with
 * reason "currency_mismatch". Linking it would only produce a price every
 * refresh refuses to apply (update-prices' own currency check), so the
 * holding would look linked and stay unpriced forever.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type ResolveAssetResult =
  | { linked: true; assetId: string }
  | { linked: false; reason: "no_ticker" | "no_source" | "unmatched" }
  | { linked: false; reason: "currency_mismatch"; marketCurrency: string };

export interface ResolveAssetInput {
  ticker: string | null;
  assetClass: AssetClass;
  /** The holding's currency. Must match what the market quotes in (BRL on B3, USD on a US listing). */
  currency: string;
}

const BRAZILIAN_CLASSES: readonly AssetClass[] = ["stocks", "fii", "bdr"];
const INTERNATIONAL_CLASSES: readonly AssetClass[] = ["international_stocks", "international_etf"];
const NO_SOURCE_CLASSES: readonly AssetClass[] = ["fixed_income", "savings"];

async function upsertAsset(db: Db, market: Market, symbol: string, assetClass: AssetClass, currency: string, sourceRefs: { source: string; externalId: string }[]): Promise<string> {
  const asset = await db.asset.upsert({
    where: { market_symbol_currency: { market, symbol, currency } },
    create: { market, symbol, assetClass, currency },
    update: {},
  });
  for (const ref of sourceRefs) {
    await db.assetSourceRef.upsert({
      where: { assetId_source: { assetId: asset.id, source: ref.source } },
      create: { assetId: asset.id, source: ref.source, externalId: ref.externalId },
      update: { externalId: ref.externalId },
    });
  }
  return asset.id;
}

export async function resolveAsset(db: Db, input: ResolveAssetInput): Promise<ResolveAssetResult> {
  const ticker = input.ticker?.trim().toUpperCase();
  if (!ticker) return { linked: false, reason: "no_ticker" };

  if (NO_SOURCE_CLASSES.includes(input.assetClass)) return { linked: false, reason: "no_source" };

  if (input.assetClass === "crypto") {
    const coinId = CRYPTO_SYMBOL_TO_COINGECKO_ID[ticker];
    if (!coinId) return { linked: false, reason: "unmatched" };
    const currency = input.currency.trim().toUpperCase() || "USD";
    const assetId = await upsertAsset(db, "CRYPTO", ticker, "crypto", currency, [{ source: "coingecko", externalId: `${coinId}:${currency.toLowerCase()}` }]);
    return { linked: true, assetId };
  }

  // A holding classified just "etf" with no hint of which market: the ticker's own shape (ends in a digit on B3) decides, same as quoteSourceFor.
  const isBrazilian = BRAZILIAN_CLASSES.includes(input.assetClass) || (input.assetClass === "etf" && isBrazilianTicker(ticker));
  const holdingCurrency = input.currency.trim().toUpperCase();
  if (isBrazilian) {
    if (holdingCurrency && holdingCurrency !== "BRL") return { linked: false, reason: "currency_mismatch", marketCurrency: "BRL" };
    const assetId = await upsertAsset(db, "B3", ticker, input.assetClass, "BRL", [{ source: "brapi", externalId: ticker }]);
    return { linked: true, assetId };
  }

  const isInternational = INTERNATIONAL_CLASSES.includes(input.assetClass) || input.assetClass === "etf";
  if (isInternational) {
    // A plain ticker is a US listing, quoted in USD. One with an exchange suffix (VWRL.L, SHOP.TO) quotes in its own exchange's currency, which GLOBAL_QUOTE does not report: the holding's is trusted, and acceptPrice rejects a mismatch per quote.
    const usListing = !ticker.includes(".");
    if (usListing && holdingCurrency && holdingCurrency !== "USD") return { linked: false, reason: "currency_mismatch", marketCurrency: "USD" };
    const currency = holdingCurrency || "USD";
    const assetId = await upsertAsset(db, "US", ticker, input.assetClass, currency, [{ source: ALPHA_VANTAGE_SOURCE, externalId: alphaVantageExternalId(ticker) }]);
    return { linked: true, assetId };
  }

  return { linked: false, reason: "unmatched" };
}
