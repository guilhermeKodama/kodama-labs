import type { CoastFireResult, FireAssumptions } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';

/**
 * Coast FIRE number: the amount needed today that, with NO further
 * contributions, compounds to `fireNumber` by `targetMonths`.
 *   coastNumber = F / (1 + r)^m
 * With r <= 0 the result is >= F (coasting is impossible without real growth) —
 * surfaced honestly rather than hidden.
 */
export function computeCoastNumber(
  fireNumber: number,
  monthlyRealReturn: number,
  targetMonths: number
): number {
  if (targetMonths <= 0) return fireNumber;
  return fireNumber / Math.pow(1 + monthlyRealReturn, targetMonths);
}

export function computeCoastFire(a: FireAssumptions, targetMonths: number): CoastFireResult {
  const r = toMonthlyRate(a.realAnnualReturn);
  const fireNumber = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
  const coastNumber = computeCoastNumber(fireNumber, r, targetMonths);
  return {
    coastNumber,
    reached: a.currentInvested >= coastNumber,
    progress: coastNumber > 0 ? a.currentInvested / coastNumber : 0,
    targetMonths,
  };
}
