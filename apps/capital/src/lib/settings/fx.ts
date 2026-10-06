/**
 * Rates are stored as units of a currency per one unit of the base
 * (Currency.manualRate: USD 0.1848 on a BRL base); Moedas e câmbio shows
 * and takes them the other way round, in the base currency (USD 5,41).
 */
export function basePerUnit(manualRate: number): number | null {
  return manualRate > 0 && Number.isFinite(manualRate) ? 1 / manualRate : null;
}

/** The manualRate to store for a rate typed in the base currency; null when it is not a positive number. */
export function manualRateFromBase(value: number): number | null {
  return value > 0 && Number.isFinite(value) ? 1 / value : null;
}

/** Digits to show a base-currency rate with: 2 for 5,41, up to 6 for tiny ones (0,000185 per JPY on a USD base…). */
export function rateDigits(value: number): { min: number; max: number } {
  return Math.abs(value) >= 0.01 ? { min: 2, max: 4 } : { min: 2, max: 6 };
}
