import { RATE_EPSILON } from './rates';

/**
 * The FIRE number: the portfolio that sustains `annualExpenses` at the safe
 * withdrawal rate. At swr = 0.04 this is the classic 25x rule.
 */
export function computeFireNumber(annualExpenses: number, swr: number): number {
  if (swr <= 0) throw new Error('safeWithdrawalRate must be > 0');
  return annualExpenses / swr;
}

/**
 * Months for a single constant-contribution stream to grow from `P` to `F`.
 *
 * Closed form of FV(n) = P(1+r)^n + c·((1+r)^n - 1)/r = F, solved for n:
 *   (1+r)^n = (F + c/r) / (P + c/r)  =>  n = ln(ratio) / ln(1+r)
 *
 * Returns 0 if already reached, Infinity if never reachable. The single guard
 * `ratio > 0 && isFinite(n) && n > 0` correctly handles positive returns,
 * the r -> 0 linear degenerate case, and the negative-return asymptote (where
 * the balance converges to -c/r and `F` above it is unreachable).
 */
export function monthsToReach(P: number, c: number, r: number, F: number): number {
  if (P >= F) return 0;

  if (Math.abs(r) < RATE_EPSILON) {
    // FV(n) = P + c·n
    return c > 0 ? (F - P) / c : Infinity;
  }

  const shift = c / r;
  const ratio = (F + shift) / (P + shift);
  if (ratio <= 0) return Infinity;

  const n = Math.log(ratio) / Math.log(1 + r);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}
