import type { FireAssumptions, FireTier, FireTierResult } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { monthsToFirePhased } from './phases';

export interface TierOptions {
  /** Lean lifestyle multiplier on target income (default 0.7). */
  lean?: number;
  /** Fat lifestyle multiplier on target income (default 1.6). */
  fat?: number;
  /** Part-time income for the Barista tier; reduces the income the portfolio must cover. */
  baristaMonthlyIncome?: number;
}

/**
 * Lean / Regular / Fat / (Barista) targets as comparison markers. Each is the
 * same math with a different effective monthly income. Implemented once and
 * mapped over the tier table so SWR stays the single lever.
 */
export function computeTiers(a: FireAssumptions, opts: TierOptions = {}): FireTierResult[] {
  const r = toMonthlyRate(a.realAnnualReturn);

  const make = (tier: FireTier, multiplier: number, monthlyIncome: number): FireTierResult => {
    const fireNumber = computeFireNumber(monthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
    return {
      tier,
      expenseMultiplier: multiplier,
      fireNumber,
      progress: fireNumber > 0 ? a.currentInvested / fireNumber : 0,
      monthsToFire: monthsToFirePhased(a.currentInvested, a.phases, r, fireNumber),
    };
  };

  const lean = opts.lean ?? 0.7;
  const fat = opts.fat ?? 1.6;

  const tiers: FireTierResult[] = [
    make('lean', lean, a.targetMonthlyIncome * lean),
    make('regular', 1, a.targetMonthlyIncome),
    make('fat', fat, a.targetMonthlyIncome * fat),
  ];

  if (opts.baristaMonthlyIncome && opts.baristaMonthlyIncome > 0) {
    const effective = Math.max(0, a.targetMonthlyIncome - opts.baristaMonthlyIncome);
    const multiplier = a.targetMonthlyIncome > 0 ? effective / a.targetMonthlyIncome : 0;
    tiers.push(make('barista', multiplier, effective));
  }

  return tiers;
}
