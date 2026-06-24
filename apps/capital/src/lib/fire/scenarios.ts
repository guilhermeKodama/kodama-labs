import type { FireAssumptions, FireScenarioKey, FireScenarioResult } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { monthsToFirePhased } from './phases';

export interface ScenarioDeltas {
  /** Added to the real annual return (default -0.02). */
  pessimistic?: number;
  /** Added to the real annual return (default +0.02). */
  optimistic?: number;
}

/**
 * Pessimistic / realistic / optimistic timelines by varying the real annual
 * return. Each scenario reruns the same phased solver — scenarios are a config
 * fan-out, not new math. Invariant: months pessimistic >= realistic >= optimistic.
 */
export function computeScenarios(
  base: FireAssumptions,
  deltas: ScenarioDeltas = {}
): FireScenarioResult[] {
  const dPess = deltas.pessimistic ?? -0.02;
  const dOpt = deltas.optimistic ?? 0.02;
  const fireNumber = computeFireNumber(
    base.targetMonthlyIncome * MONTHS_PER_YEAR,
    base.safeWithdrawalRate
  );

  const variants: Array<{ key: FireScenarioKey; realAnnualReturn: number }> = [
    { key: 'pessimistic', realAnnualReturn: base.realAnnualReturn + dPess },
    { key: 'realistic', realAnnualReturn: base.realAnnualReturn },
    { key: 'optimistic', realAnnualReturn: base.realAnnualReturn + dOpt },
  ];

  return variants.map(({ key, realAnnualReturn }) => {
    const r = toMonthlyRate(realAnnualReturn);
    const months = monthsToFirePhased(base.currentInvested, base.phases, r, fireNumber);
    return {
      key,
      realAnnualReturn,
      monthsToFire: months,
      yearsToFire: months / MONTHS_PER_YEAR,
      projectedFireMonthIndex: Number.isFinite(months) ? Math.ceil(months) : Infinity,
    };
  });
}
