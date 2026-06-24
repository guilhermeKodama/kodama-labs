import type { PhaseShape } from './types';
import { RATE_EPSILON } from './rates';

export interface SolveContributionArgs {
  currentInvested: number;
  monthlyRealReturn: number;
  fireNumber: number;
  /** When the user wants to reach FIRE (months from now). */
  targetMonths: number;
  /** The phase profile (relative intensities). */
  shape: PhaseShape[];
}

/**
 * "By date" mode: the base monthly contribution `c0` such that contributing
 * `c0 · intensity_i` through each phase reaches the FIRE number exactly at
 * `targetMonths`.
 *
 * Future value is AFFINE in `c0` (return and shape fixed), so this is a closed
 * division — no iteration:
 *
 *   FV(N) = P·(1+r)^N + c0·Σ_i intensity_i · A_i
 *   A_i   = (1+r)^(N - end_i) · ((1+r)^L_i - 1)/r
 *   c0    = (F - P·(1+r)^N) / Σ_i intensity_i · A_i
 *
 * Returns 0 when growth alone already reaches the target by the date, and
 * Infinity when no positive contribution can (e.g. all-zero shape, or the
 * target is in the past).
 */
export function solveBaseContributionForDate(args: SolveContributionArgs): number {
  const { currentInvested: P, monthlyRealReturn: r, fireNumber: F, targetMonths: N, shape } = args;
  if (N <= 0) return Infinity;

  const growthOnly = P * Math.pow(1 + r, N);
  const needed = F - growthOnly;
  if (needed <= 0) return 0;

  let denom = 0;
  for (const s of shape) {
    const end = s.toMonth == null ? N : Math.min(s.toMonth, N);
    const length = Math.max(0, end - s.fromMonth);
    if (length <= 0) continue;

    const factor =
      Math.abs(r) < RATE_EPSILON
        ? length
        : Math.pow(1 + r, N - end) * ((Math.pow(1 + r, length) - 1) / r);

    denom += s.intensity * factor;
  }

  if (denom <= 0) return Infinity;
  return needed / denom;
}
