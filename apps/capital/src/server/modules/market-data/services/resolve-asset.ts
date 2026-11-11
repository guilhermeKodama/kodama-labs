import type { AssetClass, Prisma, PrismaClient } from "@/generated/prisma";
import { isBrazilianTicker } from "../lib/ticker";
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
 * Idempotent: resolving the same (ticker, assetClass, currency) again finds
 * the Asset already created for it (the @@unique on Asset) and upserts the
 * same source refs, never a duplicate.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type ResolveAssetResult =
  | { linked: true; assetId: string }
  | { linked: false; reason: "no_ticker" | "no_source" | "unmatched" };

export interface ResolveAssetInput {
  ticker: string | null;
  assetClass: AssetClass;
  /** The holding's currency. Ignored for B3 instruments, which are always priced in BRL. */
  currency: string;
}

const BRAZILIAN_CLASSES: readonly AssetClass[] = ["stocks", "fii", "bdr"];
const INTERNATIONAL_CLASSES: readonly AssetClass[] = ["international_stocks", "international_etf"];
const NO_SOURCE_CLASSES: readonly AssetClass[] = ["fixed_income", "savings"];

async function upsertAsset(db: Db, symbol: string, assetClass: AssetClass, currency: string, sourceRefs: { source: string; externalId: string }[]): Promise<string> {
  const asset = await db.asset.upsert({
    where: { symbol_assetClass_currency: { symbol, assetClass, currency } },
    create: { symbol, assetClass, currency },
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
    const assetId = await upsertAsset(db, ticker, "crypto", currency, [{ source: "coingecko", externalId: `${coinId}:${currency.toLowerCase()}` }]);
    return { linked: true, assetId };
  }

  // A holding classified just "etf" with no hint of which market: the ticker's own shape (ends in a digit on B3) decides, same as quoteSourceFor.
  const isBrazilian = BRAZILIAN_CLASSES.includes(input.assetClass) || (input.assetClass === "etf" && isBrazilianTicker(ticker));
  if (isBrazilian) {
    const assetId = await upsertAsset(db, ticker, input.assetClass, "BRL", [
      { source: "brapi", externalId: ticker },
      { source: "yahoo", externalId: `${ticker}.SA` },
    ]);
    return { linked: true, assetId };
  }

  const isInternational = INTERNATIONAL_CLASSES.includes(input.assetClass) || input.assetClass === "etf";
  if (isInternational) {
    const currency = input.currency.trim().toUpperCase() || "USD";
    const assetId = await upsertAsset(db, ticker, input.assetClass, currency, [{ source: "yahoo", externalId: ticker }]);
    return { linked: true, assetId };
  }

  return { linked: false, reason: "unmatched" };
}
