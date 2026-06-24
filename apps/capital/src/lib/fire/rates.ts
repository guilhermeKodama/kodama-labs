/**
 * Rate conventions for the FIRE engine.
 *
 * The single most important decision: rates are REAL and monthly compounding
 * is GEOMETRIC. Changing either silently shifts every result, so the
 * conversions live here behind named helpers and are pinned by tests.
 */

export const MONTHS_PER_YEAR = 12;

/** Threshold below which the monthly rate is treated as zero (linear branch). */
export const RATE_EPSILON = 1e-9;

/** Geometric monthly rate from an annual rate: (1 + a)^(1/12) - 1. */
export function toMonthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate, 1 / MONTHS_PER_YEAR) - 1;
}

/**
 * Deflate a nominal annual return by annual inflation into a REAL annual
 * return: (1 + nominal) / (1 + inflation) - 1. The engine only ever sees real
 * rates; this is where the adapter crosses from nominal (how users think) to
 * real (how the math works, keeping expenses in today's money).
 */
export function toRealReturn(nominalAnnual: number, annualInflation: number): number {
  return (1 + nominalAnnual) / (1 + annualInflation) - 1;
}
