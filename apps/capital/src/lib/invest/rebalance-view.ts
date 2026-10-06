/**
 * "Onde aportar este mês": the suggestion's rows for the two tables and
 * the buy orders "Gerar ordens" records (POST /v2/investments/orders).
 */
import type { AllocationClass, AssetClass, RebalanceAsset } from "./types";

/** Whole units for listed assets; fractions for crypto. */
export function orderQuantity(asset: Pick<RebalanceAsset, "assetClass" | "approxQuantity">): number | null {
  const q = asset.approxQuantity;
  if (q === null || !(q > 0)) return null;
  const units = asset.assetClass === "crypto" ? Math.floor(q * 1e6) / 1e6 : Math.floor(q);
  return units > 0 ? units : null;
}

/** "≈ Qtd": "12 cotas" or "0,0002 BTC"; null when the asset has no price. */
export function approxQuantityLabel(
  asset: Pick<RebalanceAsset, "assetClass" | "approxQuantity" | "ticker">,
  fmt: { number(value: number, digits?: number | { min: number; max: number }): string },
  units: (count: number) => string,
): string | null {
  const q = asset.approxQuantity;
  if (q === null || !(q > 0)) return null;
  if (asset.assetClass === "crypto") return `${fmt.number(q, { min: 0, max: 6 })} ${asset.ticker ?? ""}`.trim();
  return units(Math.max(1, Math.round(q)));
}

export interface OrderDraft {
  key: string;
  holdingId: string;
  ticker: string | null;
  name: string | null;
  accountName: string | null;
  allocationClass: AllocationClass;
  assetClass: AssetClass | null;
  currency: string;
  /** Whole units (or crypto fractions) at `price`; null for assets bought by amount. */
  quantity: number | null;
  price: number | null;
  /** In the holding's currency. */
  amount: number;
}

/**
 * Buy orders for the "Por ativo" suggestion: one per held asset. Priced
 * assets buy whole units (crypto in fractions) at the current price;
 * fixed income without a price buys the suggested amount. Rows for a new
 * asset, for cash, or for a listed asset with no quote are not orders. `rateFor` converts the holding's
 * currency to the base currency (base units per unit).
 */
export function ordersFromSuggestion(assets: readonly RebalanceAsset[], rateFor: (currency: string) => number): OrderDraft[] {
  const out: OrderDraft[] = [];
  for (const a of assets) {
    if (a.kind !== "holding" || !a.holdingId || !(a.amount > 0)) continue;
    const rate = rateFor(a.currency) || 1;
    if (a.price && a.price > 0) {
      const quantity = orderQuantity(a);
      if (!quantity) continue;
      out.push({
        key: a.holdingId,
        holdingId: a.holdingId,
        ticker: a.ticker,
        name: a.name,
        accountName: a.accountName,
        allocationClass: a.allocationClass,
        assetClass: a.assetClass,
        currency: a.currency,
        quantity,
        price: a.price,
        amount: Math.round(quantity * a.price * 100) / 100,
      });
    } else if (a.assetClass === "fixed_income" || a.assetClass === "savings") {
      out.push({
        key: a.holdingId,
        holdingId: a.holdingId,
        ticker: a.ticker,
        name: a.name,
        accountName: a.accountName,
        allocationClass: a.allocationClass,
        assetClass: a.assetClass,
        currency: a.currency,
        quantity: null,
        price: null,
        amount: Math.round((a.amount / rate) * 100) / 100,
      });
    }
  }
  return out;
}

/** The orders body for POST /v2/investments/orders. */
export function ordersPayload(orders: readonly OrderDraft[], date: string, fundFromAccountId: string | null) {
  return {
    date,
    fundFromAccountId,
    orders: orders.map((o) => (o.quantity !== null && o.price !== null ? { holdingId: o.holdingId, quantity: o.quantity, price: o.price } : { holdingId: o.holdingId, amount: o.amount })),
  };
}

/**
 * Parses the "Vou aportar R$" input in whole units, as the mockup does:
 * thousands separators are ignored and a decimal part (1–2 digits after
 * the last comma or dot) is dropped.
 */
export function parseAporteAmount(text: string): number {
  const units = text.trim().replace(/[,.]\d{1,2}$/, "").replace(/\D/g, "");
  const value = Number(units);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
