import type { AllocationClass, AssetClass } from "@/generated/prisma";

/**
 * The portfolio screen and the allocation targets use six classes (the
 * mockup's Renda fixa, Ações BR, FIIs, Internacional, Cripto, Caixa); a
 * holding keeps one of the nine AssetClass values, which say how to price it.
 * This module is the single mapping between the two. The migration
 * 20261006000000_new_ui applies the same rule in SQL to the old targets.
 */

/** Display order of the six classes (mockup order). */
export const ALLOCATION_CLASSES = ["fixed_income", "br_stocks", "fii", "international", "crypto", "cash"] as const satisfies readonly AllocationClass[];

export const ASSET_CLASSES = [
  "stocks",
  "fii",
  "etf",
  "bdr",
  "fixed_income",
  "crypto",
  "savings",
  "international_stocks",
  "international_etf",
] as const satisfies readonly AssetClass[];

/** i18n key of each class label, in the `invest` messages namespace. */
export const ALLOCATION_CLASS_LABEL_KEY: Record<AllocationClass, string> = {
  fixed_income: "allocationClass.fixed_income",
  br_stocks: "allocationClass.br_stocks",
  fii: "allocationClass.fii",
  international: "allocationClass.international",
  crypto: "allocationClass.crypto",
  cash: "allocationClass.cash",
};

/**
 * Class of an asset. An ETF is Brazilian when it trades in BRL and
 * international otherwise; with no currency it is taken as Brazilian, since
 * foreign ETFs have their own international_etf.
 */
export function allocationClassOf(assetClass: AssetClass, currency?: string | null): AllocationClass {
  switch (assetClass) {
    case "fixed_income":
    case "savings":
      return "fixed_income";
    case "stocks":
      return "br_stocks";
    case "fii":
      return "fii";
    case "etf":
      return !currency || currency.toUpperCase() === "BRL" ? "br_stocks" : "international";
    case "bdr":
    case "international_stocks":
    case "international_etf":
      return "international";
    case "crypto":
      return "crypto";
  }
}

/** Class a holding counts under: its override, else the mapping of its asset class. */
export function holdingAllocationClass(h: { assetClass: AssetClass; currency?: string | null; allocationClass?: AllocationClass | null }): AllocationClass {
  return h.allocationClass ?? allocationClassOf(h.assetClass, h.currency);
}

/** A target keyed by allocation class, or by asset class (pre-new-UI clients). */
export type TargetInput = { allocationClass: AllocationClass; targetPercent: number } | { assetClass: AssetClass; targetPercent: number };

/**
 * Normalizes targets to AllocationClass, summing those that land on the same
 * class. A target has no currency, so `etfCurrency` (the currency most of
 * the user's ETF money is in, see dominantEtfCurrency) decides where an
 * `etf` target goes.
 */
export function toAllocationTargets(targets: TargetInput[], etfCurrency?: string | null): { allocationClass: AllocationClass; targetPercent: number }[] {
  const sums = new Map<AllocationClass, number>();
  for (const t of targets) {
    const cls = "allocationClass" in t ? t.allocationClass : allocationClassOf(t.assetClass, t.assetClass === "etf" ? etfCurrency : null);
    sums.set(cls, (sums.get(cls) ?? 0) + t.targetPercent);
  }
  return [...sums].map(([allocationClass, targetPercent]) => ({ allocationClass, targetPercent }));
}

/**
 * BRL when most of the user's ETF money (then most ETF holdings) is in BRL or
 * there is none, otherwise a foreign currency. Same rule as the migration.
 */
export function dominantEtfCurrency(holdings: { assetClass: AssetClass; currency: string; totalInvested: number }[]): string {
  let brl = { invested: 0, count: 0 };
  let foreign = { invested: 0, count: 0, currency: "USD" };
  for (const h of holdings) {
    if (h.assetClass !== "etf") continue;
    if (h.currency.toUpperCase() === "BRL") brl = { invested: brl.invested + h.totalInvested, count: brl.count + 1 };
    else foreign = { invested: foreign.invested + h.totalInvested, count: foreign.count + 1, currency: h.currency };
  }
  const foreignWins = foreign.invested > brl.invested || (foreign.invested === brl.invested && foreign.count > brl.count);
  return foreignWins ? foreign.currency : "BRL";
}
