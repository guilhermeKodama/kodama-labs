/**
 * The KPI strip of "Nova operação" (mockup InvestOpFlow): what a buy does
 * to the position and the average price, and what a sale yields. Fees are
 * part of the cost, as the server's cost basis counts them.
 */

export interface Position {
  quantity: number;
  /** Average cost per unit, fees included. */
  averageCost: number;
}

export interface TradeInput {
  quantity: number;
  price: number;
  fees: number;
}

export interface BuyPreview {
  total: number;
  quantityBefore: number;
  quantityAfter: number;
  averageBefore: number;
  averageAfter: number;
}

export interface SellPreview {
  total: number;
  /** Gain over the average cost, after fees. */
  gain: number;
  averageCost: number;
  /** Selling more than the position (the server refuses it: holding.oversell). */
  oversell: boolean;
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

export function buyPreview(position: Position | null, trade: TradeInput): BuyPreview {
  const q0 = finite(position?.quantity ?? 0);
  const avg0 = finite(position?.averageCost ?? 0);
  const n = Math.max(0, finite(trade.quantity));
  const price = Math.max(0, finite(trade.price));
  const fees = Math.max(0, finite(trade.fees));
  const total = n * price + fees;
  const q1 = q0 + n;
  return {
    total,
    quantityBefore: q0,
    quantityAfter: q1,
    averageBefore: avg0,
    averageAfter: q1 > 0 ? (q0 * avg0 + total) / q1 : 0,
  };
}

export function sellPreview(position: Position | null, trade: TradeInput): SellPreview {
  const q0 = finite(position?.quantity ?? 0);
  const avg = finite(position?.averageCost ?? 0);
  const n = Math.max(0, finite(trade.quantity));
  const price = Math.max(0, finite(trade.price));
  const fees = Math.max(0, finite(trade.fees));
  return {
    total: n * price - fees,
    gain: (price - avg) * n - fees,
    averageCost: avg,
    oversell: n > q0 + 1e-9,
  };
}

/** Income: tax withheld at source by type (JCP 15%; dividends, FII income and fixed-income interest here exempt or net). */
export function withheldTax(incomeType: "dividend" | "jcp" | "fii_income" | "interest", gross: number): number {
  return incomeType === "jcp" ? Math.round(Math.max(0, finite(gross)) * 0.15 * 100) / 100 : 0;
}
