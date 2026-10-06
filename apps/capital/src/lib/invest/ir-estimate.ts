/**
 * "IR estimado" on a sale (Brazilian income tax on capital gains), as an
 * estimate for the operation dialog:
 *
 * - a loss pays nothing and offsets later gains ("prejuízo compensável");
 * - BR stocks: exempt when the month's stock sales, this one included, stay
 *   within R$ 20 mil; 15% otherwise;
 * - BR ETFs: 15%, no exemption;
 * - FIIs: 20%;
 * - crypto: exempt within R$ 35 mil of sales in the month; 15% otherwise;
 * - BDRs and foreign assets: 15%;
 * - fixed income: withheld at source by the institution.
 */
import type { AssetClass } from "./types";

export const STOCK_EXEMPTION_LIMIT = 20_000;
export const CRYPTO_EXEMPTION_LIMIT = 35_000;

export type IrReason = "loss" | "stocksExempt" | "stocks" | "etf" | "fii" | "cryptoExempt" | "crypto" | "foreign" | "withheld";

export interface IrEstimate {
  /** Estimated tax in the base currency; null when it is withheld at source. */
  tax: number | null;
  rate: number;
  exempt: boolean;
  reason: IrReason;
}

export interface IrInput {
  assetClass: AssetClass;
  currency: string;
  /** Gain of this sale, in the base currency. */
  gain: number;
  /** Gross amount of this sale, in the base currency. */
  saleAmount: number;
  /** Sales of the same kind already recorded this month, in the base currency (stocks or crypto). */
  monthSales: number;
}

const taxed = (gain: number, rate: number, reason: IrReason): IrEstimate => ({ tax: Math.round(gain * rate * 100) / 100, rate, exempt: false, reason });

export function irEstimate(input: IrInput): IrEstimate {
  if (input.assetClass === "fixed_income" || input.assetClass === "savings") return { tax: null, rate: 0, exempt: false, reason: "withheld" };
  if (!(input.gain > 0)) return { tax: 0, rate: 0, exempt: false, reason: "loss" };
  const monthTotal = input.monthSales + input.saleAmount;
  switch (input.assetClass) {
    case "stocks":
      return monthTotal <= STOCK_EXEMPTION_LIMIT ? { tax: 0, rate: 0, exempt: true, reason: "stocksExempt" } : taxed(input.gain, 0.15, "stocks");
    case "etf":
      return input.currency.toUpperCase() === "BRL" ? taxed(input.gain, 0.15, "etf") : taxed(input.gain, 0.15, "foreign");
    case "fii":
      return taxed(input.gain, 0.2, "fii");
    case "crypto":
      return monthTotal <= CRYPTO_EXEMPTION_LIMIT ? { tax: 0, rate: 0, exempt: true, reason: "cryptoExempt" } : taxed(input.gain, 0.15, "crypto");
    case "bdr":
    case "international_stocks":
    case "international_etf":
      return taxed(input.gain, 0.15, "foreign");
  }
}

/** Asset classes whose monthly sales count for the same exemption (stocks with stocks, crypto with crypto). */
export function exemptionGroup(assetClass: AssetClass): "stocks" | "crypto" | null {
  return assetClass === "stocks" ? "stocks" : assetClass === "crypto" ? "crypto" : null;
}
