import type { FireAssumptions } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { contributionAtMonth } from './phases';
import { resolveRetirementMonth, type LifecycleOptions } from './lifecycle';
import { resolveDepletion } from './target';

/**
 * Monte Carlo whole-life simulation: T independent accumulate→withdraw trials,
 * each YEAR drawing a real annual return ~ Normal(realAnnualReturn, annualVolatility).
 * Yearly time-stepping keeps 1000×60 trivial in the browser. Fully seeded — same
 * seed + inputs ⇒ bit-identical output. Never calls Math.random().
 *
 * The deterministic monthly `buildLifecycle` is the precise center line; this
 * module is for the distribution (bands) and the chance of success.
 */

/** Tiny deterministic uint32-seeded PRNG → [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard-Normal deviate via Box–Muller (consumes two uniforms). */
export function nextNormal(rng: () => number): number {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12; // guard log(0)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface MonteCarloOptions {
  currentAge: number;
  retirementMonthIndex?: number;
  retirementAge?: number;
  lifeExpectancyAge: number;
  annualVolatility: number;
  trials: number;
  seed: number;
  /**
   * What counts as "success":
   * - `never_depleted` — the money never runs out (use for `perpetuity`).
   * - `lasted_to_horizon` — it lasts to the final year; depleting only in that
   *   last year is fine, not a failure (use for `depletion`).
   * - `positive_at_end` — strictly positive at the very end.
   */
  successCriterion?: 'never_depleted' | 'lasted_to_horizon' | 'positive_at_end';
}

export interface MonteCarloPoint {
  age: number;
  yearOffset: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  points: MonteCarloPoint[];
  successProbability: number;
  trials: number;
  retirementYearOffset: number;
}

/** Linear-interpolation quantile (type-7 / NumPy default) on a sorted array. */
function quantileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function runMonteCarlo(a: FireAssumptions, opts: MonteCarloOptions): MonteCarloResult {
  if (opts.trials < 1) throw new Error('trials must be >= 1');
  if (opts.lifeExpectancyAge <= opts.currentAge) {
    throw new Error('lifeExpectancyAge must exceed currentAge');
  }

  const mean = a.realAnnualReturn;
  const sd = opts.annualVolatility;
  const monthlyRealReturn = toMonthlyRate(a.realAnnualReturn);
  const horizonMonthIndex = Math.ceil((opts.lifeExpectancyAge - opts.currentAge) * MONTHS_PER_YEAR);
  const strategy = a.withdrawalStrategy ?? 'perpetuity';

  // Retire at the same point the deterministic lifecycle does, per strategy.
  let retirementMonthIndex: number;
  if (strategy === 'depletion') {
    retirementMonthIndex = resolveDepletion(
      a,
      {
        currentAge: opts.currentAge,
        lifeExpectancyAge: opts.lifeExpectancyAge,
        retirementAge: opts.retirementAge,
        retirementMonthIndex: opts.retirementMonthIndex,
        annualVolatility: opts.annualVolatility,
      },
      monthlyRealReturn
    ).retirementMonthIndex;
  } else {
    const fireNumber = computeFireNumber(a.targetMonthlyIncome * MONTHS_PER_YEAR, a.safeWithdrawalRate);
    const lifecycleOpts: LifecycleOptions = {
      currentAge: opts.currentAge,
      retirementMonthIndex: opts.retirementMonthIndex,
      retirementAge: opts.retirementAge,
      lifeExpectancyAge: opts.lifeExpectancyAge,
    };
    retirementMonthIndex = resolveRetirementMonth(
      a,
      lifecycleOpts,
      monthlyRealReturn,
      fireNumber,
      horizonMonthIndex
    ).retirementMonthIndex;
  }
  const retirementYear = Math.floor(retirementMonthIndex / MONTHS_PER_YEAR);

  const years = Math.ceil(opts.lifeExpectancyAge - opts.currentAge);
  const annualWithdrawal = a.targetMonthlyIncome * MONTHS_PER_YEAR;

  // Each year's total contribution = sum of its 12 monthly contributions.
  const annualContribution = new Float64Array(years);
  for (let y = 0; y < years; y++) {
    let c = 0;
    for (let k = 0; k < MONTHS_PER_YEAR; k++) {
      c += contributionAtMonth(a.phases, y * MONTHS_PER_YEAR + k);
    }
    annualContribution[y] = c;
  }

  // netWorth matrix [year 0..years][trial].
  const byYear: Float64Array[] = [];
  for (let y = 0; y <= years; y++) byYear.push(new Float64Array(opts.trials));

  const rng = mulberry32(opts.seed);
  const criterion = opts.successCriterion ?? 'never_depleted';
  let successes = 0;

  for (let t = 0; t < opts.trials; t++) {
    let nw = a.currentInvested;
    byYear[0][t] = nw;
    let solvent = true;
    let depletedBeforeEnd = false;
    for (let y = 0; y < years; y++) {
      const g = Math.max(-0.99, mean + sd * nextNormal(rng));
      if (y < retirementYear) {
        nw = nw * (1 + g) + annualContribution[y];
      } else {
        nw = Math.max(0, nw * (1 + g) - annualWithdrawal);
        if (nw === 0) {
          solvent = false;
          if (y < years - 1) depletedBeforeEnd = true;
        }
      }
      byYear[y + 1][t] = nw;
    }
    const ok =
      criterion === 'never_depleted'
        ? solvent
        : criterion === 'lasted_to_horizon'
          ? !depletedBeforeEnd
          : byYear[years][t] > 0;
    if (ok) successes++;
  }

  const points: MonteCarloPoint[] = [];
  for (let y = 0; y <= years; y++) {
    const arr = byYear[y];
    arr.sort();
    points.push({
      age: opts.currentAge + y,
      yearOffset: y,
      p10: quantileSorted(arr, 0.1),
      p25: quantileSorted(arr, 0.25),
      p50: quantileSorted(arr, 0.5),
      p75: quantileSorted(arr, 0.75),
      p90: quantileSorted(arr, 0.9),
    });
  }

  return {
    points,
    successProbability: successes / opts.trials,
    trials: opts.trials,
    retirementYearOffset: retirementYear,
  };
}
