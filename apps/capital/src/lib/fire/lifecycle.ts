import type { FireAssumptions } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { contributionAtMonth, monthsToFirePhased } from './phases';
import { resolveDepletion } from './target';

/**
 * Whole-life net-worth model: accumulate through the contribution phases until a
 * retirement point, then withdraw a constant REAL monthly income until the
 * life-expectancy horizon. Steps monthly (exact flooring on depletion) and
 * samples yearly — the same approach as buildProjection.
 */

export type LifecyclePhaseName = 'accumulation' | 'withdrawal';

export interface LifecycleOptions {
  /** Age today (years). Anchors the age axis. */
  currentAge: number;
  /** Explicit retirement month (0-based, months from now). Highest precedence. */
  retirementMonthIndex?: number;
  /** Retirement age (years). Used when no explicit month and the trigger needs it. */
  retirementAge?: number;
  /** Simulate until this age. Must exceed currentAge. */
  lifeExpectancyAge: number;
  /** Real-return volatility (σ), so a `depletion` target carries a safety margin. */
  annualVolatility?: number | null;
  /** How to pick retirement when no explicit month: at FIRE (default) or at age. */
  retirementTrigger?: 'fire' | 'age';
}

export interface LifecyclePoint {
  monthIndex: number;
  age: number;
  yearOffset: number;
  netWorth: number;
  phase: LifecyclePhaseName;
  contributionsToDate: number;
  withdrawalsToDate: number;
  growthToDate: number;
}

export interface LifecycleResult {
  points: LifecyclePoint[];
  retirementMonthIndex: number;
  retirementAge: number;
  fireNumber: number;
  monthsToFire: number;
  fireReached: boolean;
  depleted: boolean;
  depletionMonthIndex: number | null;
  horizonMonthIndex: number;
  monthlyWithdrawal: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Resolve the retirement month from {explicit month | FIRE crossing | age},
 * shared by the lifecycle and Monte Carlo so they agree by construction.
 * Precedence: explicit month > (trigger) > horizon (pure accumulation).
 */
export function resolveRetirementMonth(
  a: FireAssumptions,
  opts: LifecycleOptions,
  monthlyRealReturn: number,
  fireNumber: number,
  horizonMonthIndex: number
): { retirementMonthIndex: number; monthsToFire: number } {
  const monthsToFire = monthsToFirePhased(a.currentInvested, a.phases, monthlyRealReturn, fireNumber);

  if (opts.retirementMonthIndex != null) {
    return { retirementMonthIndex: clamp(opts.retirementMonthIndex, 0, horizonMonthIndex), monthsToFire };
  }

  const ageMonth = () =>
    opts.retirementAge != null
      ? clamp(Math.round((opts.retirementAge - opts.currentAge) * MONTHS_PER_YEAR), 0, horizonMonthIndex)
      : horizonMonthIndex;

  const trigger = opts.retirementTrigger ?? 'fire';
  if (trigger === 'fire') {
    if (Number.isFinite(monthsToFire)) {
      return { retirementMonthIndex: Math.min(Math.ceil(monthsToFire), horizonMonthIndex), monthsToFire };
    }
    return { retirementMonthIndex: ageMonth(), monthsToFire };
  }
  return { retirementMonthIndex: ageMonth(), monthsToFire };
}

export function buildLifecycle(a: FireAssumptions, opts: LifecycleOptions): LifecycleResult {
  if (opts.lifeExpectancyAge <= opts.currentAge) {
    throw new Error('lifeExpectancyAge must exceed currentAge');
  }

  const r = toMonthlyRate(a.realAnnualReturn);
  const horizonMonthIndex = Math.ceil((opts.lifeExpectancyAge - opts.currentAge) * MONTHS_PER_YEAR);
  const strategy = a.withdrawalStrategy ?? 'perpetuity';

  let fireNumber: number;
  let retirementMonthIndex: number;
  let monthsToFire: number;
  if (strategy === 'depletion') {
    const d = resolveDepletion(
      a,
      {
        currentAge: opts.currentAge,
        lifeExpectancyAge: opts.lifeExpectancyAge,
        retirementAge: opts.retirementAge,
        retirementMonthIndex: opts.retirementMonthIndex,
        annualVolatility: opts.annualVolatility,
      },
      r
    );
    fireNumber = d.fireNumber;
    retirementMonthIndex = d.retirementMonthIndex;
    monthsToFire = d.monthsToFire;
  } else {
    fireNumber = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
    const resolved = resolveRetirementMonth(a, opts, r, fireNumber, horizonMonthIndex);
    retirementMonthIndex = resolved.retirementMonthIndex;
    monthsToFire = resolved.monthsToFire;
  }
  const w = a.targetMonthlyIncome;

  const points: LifecyclePoint[] = [];
  let balance = a.currentInvested;
  let contributions = a.currentInvested; // initial principal counts as "your money"
  let withdrawals = 0;
  let depleted = false;
  let depletionMonthIndex: number | null = null;

  const push = (monthIndex: number) => {
    points.push({
      monthIndex,
      age: opts.currentAge + monthIndex / MONTHS_PER_YEAR,
      yearOffset: monthIndex / MONTHS_PER_YEAR,
      netWorth: balance,
      phase: monthIndex > retirementMonthIndex ? 'withdrawal' : 'accumulation',
      contributionsToDate: contributions,
      withdrawalsToDate: withdrawals,
      growthToDate: balance - contributions + withdrawals,
    });
  };

  push(0);
  for (let m = 1; m <= horizonMonthIndex; m++) {
    if (m <= retirementMonthIndex) {
      const c = contributionAtMonth(a.phases, m - 1);
      balance = balance * (1 + r) + c;
      contributions += c;
    } else {
      const gross = balance * (1 + r);
      const paid = Math.min(w, Math.max(0, gross));
      balance = Math.max(0, gross - w);
      withdrawals += paid;
      if (balance === 0 && depletionMonthIndex === null) {
        depleted = true;
        depletionMonthIndex = m;
      }
    }
    if (m % MONTHS_PER_YEAR === 0 || m === horizonMonthIndex) push(m);
  }

  return {
    points,
    retirementMonthIndex,
    retirementAge: opts.currentAge + retirementMonthIndex / MONTHS_PER_YEAR,
    fireNumber,
    monthsToFire,
    fireReached: Number.isFinite(monthsToFire) && monthsToFire <= horizonMonthIndex,
    depleted,
    depletionMonthIndex,
    horizonMonthIndex,
    monthlyWithdrawal: w,
  };
}
