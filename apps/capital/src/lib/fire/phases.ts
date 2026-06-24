import type { ContributionPhase } from './types';
import { RATE_EPSILON } from './rates';
import { monthsToReach } from './fire-number';

/** Future value of `B` after `L` months of `c`/month at monthly rate `r`. */
export function phaseEndingBalance(B: number, c: number, L: number, r: number): number {
  if (L <= 0) return B;
  if (Math.abs(r) < RATE_EPSILON) return B + c * L;
  const growth = Math.pow(1 + r, L);
  return B * growth + (c * (growth - 1)) / r;
}

/** The monthly contribution active at a given month index. The last phase extends to the horizon. */
export function contributionAtMonth(phases: ContributionPhase[], monthIndex: number): number {
  if (phases.length === 0) return 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const isLast = i === phases.length - 1;
    const within = monthIndex >= p.fromMonth && (isLast || p.toMonth == null || monthIndex < p.toMonth);
    if (within) return p.monthlyContribution;
  }
  return phases[phases.length - 1].monthlyContribution;
}

/**
 * Months until a phased contribution schedule grows `P` to `F`.
 *
 * Walks the phases, carrying the balance forward with the closed-form
 * `phaseEndingBalance`, and within the phase where the target is crossed solves
 * the exact (fractional) month with `monthsToReach`. The last phase is treated
 * as open-ended. Returns 0 if already reached, Infinity if never reachable.
 *
 * Phases are assumed contiguous (each `fromMonth` equals the previous `toMonth`).
 */
export function monthsToFirePhased(
  P: number,
  phases: ContributionPhase[],
  r: number,
  F: number
): number {
  if (P >= F) return 0;
  if (phases.length === 0) return Infinity;

  let balance = P;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;
    const length =
      isLast || phase.toMonth == null ? Infinity : Math.max(0, phase.toMonth - phase.fromMonth);

    const within = monthsToReach(balance, phase.monthlyContribution, r, F);
    if (within <= length) return phase.fromMonth + within;

    balance = phaseEndingBalance(balance, phase.monthlyContribution, length, r);
  }

  return Infinity;
}
