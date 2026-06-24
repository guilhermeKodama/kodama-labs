import type { FireAssumptions, FireProjection, FireProjectionPoint } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { contributionAtMonth, monthsToFirePhased } from './phases';

export interface BuildProjectionOptions {
  /** Months to keep plotting past the FIRE crossing (default 36). */
  horizonPaddingMonths?: number;
  /** Cap when FIRE is never reached, so the chart still renders (default 600). */
  maxHorizonMonths?: number;
  /** Down-sample the returned points (default 1 = monthly). */
  samplingEveryMonths?: 1 | 12;
}

/**
 * Month-by-month projection of the portfolio, decomposed into the principal
 * you contribute and the market growth on top — ready for a stacked Recharts
 * area chart. The constant FIRE-number line is NOT part of the series (draw it
 * as a Recharts ReferenceLine); we return `fireNumber` for that.
 */
export function buildProjection(
  a: FireAssumptions,
  opts: BuildProjectionOptions = {}
): FireProjection {
  const r = toMonthlyRate(a.realAnnualReturn);
  const fireNumber = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
  const monthsToFire = monthsToFirePhased(a.currentInvested, a.phases, r, fireNumber);

  const padding = opts.horizonPaddingMonths ?? 36;
  const maxHorizon = opts.maxHorizonMonths ?? 600;
  const sampling = opts.samplingEveryMonths ?? 1;
  const horizon = Number.isFinite(monthsToFire)
    ? Math.min(maxHorizon, Math.ceil(monthsToFire) + padding)
    : maxHorizon;

  const points: FireProjectionPoint[] = [];
  let invested = a.currentInvested;
  let contributed = a.currentInvested; // initial principal counts as "your money"

  const push = (monthIndex: number) => {
    points.push({
      monthIndex,
      yearOffset: monthIndex / MONTHS_PER_YEAR,
      investedValue: invested,
      contributionsToDate: contributed,
      growthToDate: invested - contributed,
      reachedFire: invested >= fireNumber,
    });
  };

  push(0);
  for (let m = 1; m <= horizon; m++) {
    const c = contributionAtMonth(a.phases, m - 1);
    invested = invested * (1 + r) + c;
    contributed += c;
    if (m % sampling === 0 || m === horizon) push(m);
  }

  return { points, samplingEveryMonths: sampling, fireNumber, monthsToFire };
}
