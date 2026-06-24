import type { FireAssumptions, FireResult } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { monthsToFirePhased } from './phases';
import { computeSavingsRate } from './savings';
import { canDeplete, resolveDepletion } from './target';

/**
 * Age context needed to size a `depletion` target (the drawdown horizon). When
 * absent — or the strategy is `perpetuity` — the headline uses the classic
 * annualExpenses / SWR number, which is independent of timing.
 */
export interface FireResultOptions {
  currentAge?: number | null;
  lifeExpectancyAge?: number | null;
  retirementAge?: number | null;
  /** Real-return volatility (σ), so a `depletion` target carries a safety margin. */
  annualVolatility?: number | null;
}

/**
 * The headline FIRE result: number, progress, time-to-FIRE and passive income.
 *
 * Note: income-based progress (passive income / target expenses) is
 * algebraically identical to asset progress (invested / fireNumber), so we
 * report a single `progress` and expose `currentMonthlyPassiveIncome` for the
 * "you currently generate R$X/mo" label — never a second, divergent metric.
 */
export function computeFireResult(a: FireAssumptions, opts: FireResultOptions = {}): FireResult {
  const monthlyRealReturn = toMonthlyRate(a.realAnnualReturn);
  const strategy = a.withdrawalStrategy ?? 'perpetuity';

  let fireNumber: number;
  let monthsToFire: number;
  if (canDeplete(strategy, opts.currentAge, opts.lifeExpectancyAge)) {
    const d = resolveDepletion(
      a,
      {
        currentAge: opts.currentAge as number,
        lifeExpectancyAge: opts.lifeExpectancyAge as number,
        retirementAge: opts.retirementAge,
        annualVolatility: opts.annualVolatility,
      },
      monthlyRealReturn
    );
    fireNumber = d.fireNumber;
    monthsToFire = d.monthsToFire;
  } else {
    fireNumber = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
    monthsToFire = monthsToFirePhased(a.currentInvested, a.phases, monthlyRealReturn, fireNumber);
  }
  const firstContribution = a.phases[0]?.monthlyContribution ?? 0;

  return {
    fireNumber,
    currentInvested: a.currentInvested,
    progress: fireNumber > 0 ? a.currentInvested / fireNumber : 0,
    reached: a.currentInvested >= fireNumber,
    monthsToFire,
    yearsToFire: monthsToFire / MONTHS_PER_YEAR,
    currentMonthlyPassiveIncome: (a.currentInvested * a.safeWithdrawalRate) / MONTHS_PER_YEAR,
    monthlyRealReturn,
    savingsRate:
      a.monthlyIncome != null ? computeSavingsRate(firstContribution, a.monthlyIncome) : null,
  };
}
