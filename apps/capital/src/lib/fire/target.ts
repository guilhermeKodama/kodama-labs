import type { FireAssumptions, WithdrawalStrategy } from './types';
import { MONTHS_PER_YEAR, RATE_EPSILON, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { contributionAtMonth, monthsToFirePhased } from './phases';

export type { WithdrawalStrategy };

/** Just the bits of FireAssumptions needed to size a depletion target. */
export type DepletionInputs = Pick<
  FireAssumptions,
  'targetMonthlyIncome' | 'realAnnualReturn' | 'safeWithdrawalRate'
>;

export interface DepletionOptions {
  currentAge: number;
  lifeExpectancyAge: number;
  /** Real-return volatility (σ). Used for the median (geometric) compounding. */
  annualVolatility?: number | null;
  /** Fixed retirement age (planning by date). */
  retirementAge?: number | null;
  /** Explicit retirement month (highest precedence). */
  retirementMonthIndex?: number | null;
}

export interface DepletionTargetResult {
  /** Capital needed at retirement to fund the drawdown to the horizon. */
  fireNumber: number;
  /** Resolved retirement month (0-based, months from now). */
  retirementMonthIndex: number;
  /** Months from now until that capital is accumulated (Infinity if never). */
  monthsToFire: number;
  /** Months from now to life expectancy. */
  horizonMonthIndex: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Capital required at retirement to fund a constant REAL `monthlyWithdrawal` for
 * `monthsInRetirement`, depleting to ~0 while the balance earns `monthlyRealReturn`.
 *
 * Present value of an ordinary (end-of-period) annuity, matching the lifecycle's
 * "grow then withdraw" mechanics: B·(1+r)^n − w·((1+r)^n − 1)/r = 0 ⇒
 *   B = w · (1 − (1+r)^(−n)) / r   (and B = w·n at r → 0).
 */
export function depletionTarget(
  monthlyWithdrawal: number,
  monthlyRealReturn: number,
  monthsInRetirement: number
): number {
  if (monthsInRetirement <= 0) return 0;
  const r = monthlyRealReturn;
  if (Math.abs(r) < RATE_EPSILON) return monthlyWithdrawal * monthsInRetirement;
  return (monthlyWithdrawal * (1 - Math.pow(1 + r, -monthsInRetirement))) / r;
}

/**
 * The MEDIAN compounded real return: the expected (arithmetic) real return less
 * the volatility drag (σ²/2, the gap between arithmetic and geometric growth).
 * Sizing the drawdown at this rate runs the *median* Monte-Carlo path out exactly
 * at the horizon — half the outcomes leave a surplus, half fall a little short,
 * which is precisely what "spend down to ~zero by life expectancy" means. Zero
 * volatility ⇒ the expected return (the exact die-with-zero annuity).
 */
function medianRealReturn(realAnnualReturn: number, annualVolatility: number): number {
  if (annualVolatility <= 0) return realAnnualReturn;
  return realAnnualReturn - (annualVolatility * annualVolatility) / 2;
}

/**
 * Capital needed at retirement under the depletion strategy: the annuity that
 * funds the income to the horizon at the median compound return, so the median
 * path lands near zero exactly at life expectancy — and never more than the
 * perpetuity number (you can't need more to spend down than to live off the
 * yield forever).
 */
export function depletionFireNumber(
  a: DepletionInputs,
  annualVolatility: number,
  monthsInRetirement: number
): number {
  if (monthsInRetirement <= 0) return 0;
  const planning = toMonthlyRate(medianRealReturn(a.realAnnualReturn, annualVolatility));
  const annuity = depletionTarget(a.targetMonthlyIncome, planning, monthsInRetirement);
  const perpetuity = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
  return Math.min(annuity, perpetuity);
}

/**
 * First month at which the accumulated balance can fund a depleting retirement
 * all the way to the horizon. As the months pass the balance rises while the
 * remaining drawdown shrinks, so the two curves cross exactly once.
 */
function depletionCrossing(
  a: FireAssumptions,
  monthlyRealReturn: number,
  annualVolatility: number,
  horizonMonthIndex: number
): number {
  let balance = a.currentInvested;
  if (balance >= depletionFireNumber(a, annualVolatility, horizonMonthIndex)) return 0;
  for (let m = 1; m <= horizonMonthIndex; m++) {
    balance = balance * (1 + monthlyRealReturn) + contributionAtMonth(a.phases, m - 1);
    if (balance >= depletionFireNumber(a, annualVolatility, horizonMonthIndex - m)) {
      return m;
    }
  }
  return horizonMonthIndex; // trivially "reached" at the horizon (target → 0)
}

/**
 * Resolve the depletion target (number + retirement timing). Retirement is, in
 * precedence order: an explicit month, a fixed retirement age (planning by date),
 * or the self-consistent crossing where the balance first covers the drawdown.
 */
export function resolveDepletion(
  a: FireAssumptions,
  opts: DepletionOptions,
  monthlyRealReturn: number
): DepletionTargetResult {
  const horizonMonthIndex = Math.ceil((opts.lifeExpectancyAge - opts.currentAge) * MONTHS_PER_YEAR);
  const annualVolatility = opts.annualVolatility ?? 0;

  let fixedRetirement = false;
  let retirementMonthIndex: number;
  if (opts.retirementMonthIndex != null) {
    retirementMonthIndex = clamp(opts.retirementMonthIndex, 0, horizonMonthIndex);
    fixedRetirement = true;
  } else if (opts.retirementAge != null) {
    retirementMonthIndex = clamp(
      Math.round((opts.retirementAge - opts.currentAge) * MONTHS_PER_YEAR),
      0,
      horizonMonthIndex
    );
    fixedRetirement = true;
  } else {
    retirementMonthIndex = depletionCrossing(a, monthlyRealReturn, annualVolatility, horizonMonthIndex);
  }

  const fireNumber = depletionFireNumber(a, annualVolatility, horizonMonthIndex - retirementMonthIndex);
  const monthsToFire = fixedRetirement
    ? monthsToFirePhased(a.currentInvested, a.phases, monthlyRealReturn, fireNumber)
    : retirementMonthIndex;

  return { fireNumber, retirementMonthIndex, monthsToFire, horizonMonthIndex };
}

/** Whether a strategy + options can produce a depletion target (needs a valid horizon). */
export function canDeplete(
  strategy: WithdrawalStrategy,
  currentAge: number | null | undefined,
  lifeExpectancyAge: number | null | undefined
): boolean {
  return (
    strategy === 'depletion' &&
    currentAge != null &&
    lifeExpectancyAge != null &&
    lifeExpectancyAge > currentAge
  );
}
