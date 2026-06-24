import type { ContributionPhase, FireAssumptions, PhaseShape, PlanningMode } from './types';
import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber } from './fire-number';
import { contributionAtMonth } from './phases';
import { resolvePhases } from './profiles';
import { solveBaseContributionForDate } from './solve';
import { MC_SEED, MC_TRIALS, runMonteCarlo } from './monte-carlo';
import { depletionFireNumber, resolveDepletion } from './target';

/**
 * Size the `depletion` ("die with zero") target by inverting the actual seeded
 * Monte-Carlo simulation, instead of a closed form.
 *
 * During decumulation the recurrence is affine with a FIXED withdrawal
 * (`nw = max(0, nw·(1+g) − annualWithdrawal)`), so sequence-of-returns risk pulls
 * the *median* terminal wealth below any geometric-mean annuity — there is no
 * clean closed form. We therefore binary-search the one free lever so the MC
 * median net worth (the cyan p50 line) lands at ~0 exactly at life expectancy:
 *
 * - `by_contribution` — contributions are given; the lever is the retirement
 *   month. Search the earliest retirement year whose median still reaches the
 *   horizon.
 * - `by_date` — retirement is pinned to the chosen year; the lever is the base
 *   monthly contribution. Search the smallest contribution whose median reaches
 *   the horizon.
 *
 * At the solved point the median terminal wealth ≈ 0, i.e. P(leaving a surplus)
 * ≈ 50% — half the random paths leave something, half fall a little short. This
 * is the intended semantics of spending down to ~zero by life expectancy.
 *
 * Deterministic given the seed/trials, so the server and the client compute the
 * exact same plan.
 */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface SolveDepletionInput {
  currentInvested: number;
  targetMonthlyIncome: number;
  safeWithdrawalRate: number;
  /** REAL annual return (already deflated by inflation). */
  realAnnualReturn: number;
  /** Real-return volatility (σ). ≤ 0 short-circuits to the exact die-with-zero annuity. */
  annualVolatility: number;
  currentAge: number;
  lifeExpectancyAge: number;
  planningMode: PlanningMode;
  /** by_contribution: the user's contribution schedule (the lever is retirement timing). */
  phases?: ContributionPhase[];
  /** by_date: the phase shape to scale (the lever is the base contribution). */
  shape?: PhaseShape[];
  /** by_date: retirement is pinned to this month (months from now). */
  targetMonths?: number;
  /** MC seed (defaults to the shared MC_SEED so server and client agree). */
  seed?: number;
  /** MC trial count (defaults to the shared MC_TRIALS). */
  trials?: number;
}

export interface SolveDepletionResult {
  /** Retirement month to pin into buildLifecycle / runMonteCarlo (highest precedence). */
  retirementMonthIndex: number;
  /** Deterministic nest egg at retirement — the FIRE number to display. */
  fireNumber: number;
  /** Months from now until FIRE (by_contribution: = retirementMonthIndex; by_date: = targetMonths). */
  monthsToFire: number;
  /** Months from now to life expectancy. */
  horizonMonthIndex: number;
  /** P(leaving a surplus) at the resolved point — ~0.5 by construction. */
  successProbability: number;
  /** false ⇒ the plan can't reach a ~50% spend-down (surface "unreachable"). */
  reachable: boolean;
  /** by_date: the solved base monthly contribution (Infinity ⇒ unreachable, 0 ⇒ growth alone suffices). */
  baseContribution?: number;
  /** by_date: the resolved concrete phases for the prescribed contribution. */
  phases?: ContributionPhase[];
}

/**
 * Deterministic accumulated balance at month `months`, matching buildLifecycle's
 * month-by-month accumulation recurrence exactly (so the displayed deterministic
 * peak equals this FIRE number).
 */
function balanceAtMonth(
  currentInvested: number,
  phases: ContributionPhase[],
  monthlyRealReturn: number,
  months: number
): number {
  let balance = currentInvested;
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + monthlyRealReturn) + contributionAtMonth(phases, m - 1);
  }
  return balance;
}

/**
 * σ = 0 ⇒ no distribution: the median IS the deterministic path, so the exact
 * die-with-zero annuity already lands the line at zero at the horizon. Use the
 * closed form (and so coincide with `depletionFireNumber`/`resolveDepletion`).
 */
function deterministicDepletionPlan(
  input: SolveDepletionInput,
  monthlyRealReturn: number,
  horizonMonthIndex: number
): SolveDepletionResult {
  const {
    currentInvested,
    targetMonthlyIncome,
    safeWithdrawalRate,
    realAnnualReturn,
    currentAge,
    lifeExpectancyAge,
    planningMode,
  } = input;

  if (planningMode === 'by_date') {
    const shape = input.shape ?? [];
    const targetMonths = input.targetMonths ?? 0;
    const monthsInRetirement = Math.max(0, horizonMonthIndex - targetMonths);
    const fireNumber = depletionFireNumber(
      { targetMonthlyIncome, realAnnualReturn, safeWithdrawalRate },
      0,
      monthsInRetirement
    );
    const baseContribution = solveBaseContributionForDate({
      currentInvested,
      monthlyRealReturn,
      fireNumber,
      targetMonths,
      shape,
    });
    const reachable = targetMonths > 0 && Number.isFinite(baseContribution);
    return {
      retirementMonthIndex: clamp(targetMonths, 0, horizonMonthIndex),
      fireNumber,
      monthsToFire: reachable ? targetMonths : Infinity,
      horizonMonthIndex,
      successProbability: 0.5,
      reachable,
      baseContribution,
      phases: resolvePhases(shape, reachable ? baseContribution : 0),
    };
  }

  const assumptions: FireAssumptions = {
    currentInvested,
    targetMonthlyIncome,
    safeWithdrawalRate,
    realAnnualReturn,
    phases: input.phases ?? [],
    withdrawalStrategy: 'depletion',
  };
  const d = resolveDepletion(assumptions, { currentAge, lifeExpectancyAge, annualVolatility: 0 }, monthlyRealReturn);
  return {
    retirementMonthIndex: d.retirementMonthIndex,
    fireNumber: d.fireNumber,
    monthsToFire: d.monthsToFire,
    horizonMonthIndex: d.horizonMonthIndex,
    successProbability: 0.5,
    reachable: Number.isFinite(d.monthsToFire),
  };
}

export function solveDepletionPlan(input: SolveDepletionInput): SolveDepletionResult {
  const {
    currentInvested,
    targetMonthlyIncome,
    safeWithdrawalRate,
    realAnnualReturn,
    annualVolatility,
    currentAge,
    lifeExpectancyAge,
    planningMode,
  } = input;

  const r = toMonthlyRate(realAnnualReturn);
  const horizonMonthIndex = Math.ceil((lifeExpectancyAge - currentAge) * MONTHS_PER_YEAR);
  const perpetuity = computeFireNumber(targetMonthlyIncome * MONTHS_PER_YEAR, safeWithdrawalRate);
  const seed = input.seed ?? MC_SEED;
  const trials = input.trials ?? MC_TRIALS;

  if (annualVolatility <= 0) {
    return deterministicDepletionPlan(input, r, horizonMonthIndex);
  }

  const assumptionsFor = (phases: ContributionPhase[]): FireAssumptions => ({
    currentInvested,
    targetMonthlyIncome,
    safeWithdrawalRate,
    realAnnualReturn,
    phases,
    withdrawalStrategy: 'depletion',
  });

  // Median terminal net worth (the p50 line at life expectancy) + P(surplus), for
  // a given contribution schedule and retirement month. Driving p50 to ~0 puts the
  // median depletion exactly at the horizon; positive_at_end is then ≈ 0.5.
  const evalAt = (phases: ContributionPhase[], retirementMonthIndex: number) => {
    const mc = runMonteCarlo(assumptionsFor(phases), {
      currentAge,
      lifeExpectancyAge,
      annualVolatility,
      retirementMonthIndex,
      trials,
      seed,
      successCriterion: 'positive_at_end',
    });
    return { p50: mc.points[mc.points.length - 1].p50, success: mc.successProbability };
  };

  if (planningMode === 'by_contribution') {
    const phases = input.phases ?? [];
    const atMonth = (m: number) => evalAt(phases, m);

    // Today's capital already sustains the drawdown — you can retire now.
    const now = atMonth(0);
    if (now.p50 > 0) {
      return {
        retirementMonthIndex: 0,
        fireNumber: currentInvested,
        monthsToFire: 0,
        horizonMonthIndex,
        successProbability: now.success,
        reachable: true,
      };
    }
    // Even retiring at the horizon can't sustain it (degenerate: ~no capital).
    const top = atMonth(horizonMonthIndex);
    if (top.p50 <= 0) {
      return {
        retirementMonthIndex: horizonMonthIndex,
        fireNumber: balanceAtMonth(currentInvested, phases, r, horizonMonthIndex),
        monthsToFire: Infinity,
        horizonMonthIndex,
        successProbability: top.success,
        reachable: false,
      };
    }
    // Earliest retirement MONTH whose median still reaches ~0 at life expectancy.
    // runMonteCarlo splits the boundary year, so month granularity lands the p50
    // right at the horizon (a whole-year step would over/undershoot badly).
    let lo = 0; // p50 ≤ 0
    let hi = horizonMonthIndex; // p50 > 0
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (atMonth(mid).p50 > 0) hi = mid;
      else lo = mid;
    }
    const final = atMonth(hi);
    return {
      retirementMonthIndex: hi,
      fireNumber: balanceAtMonth(currentInvested, phases, r, hi),
      monthsToFire: hi,
      horizonMonthIndex,
      successProbability: final.success,
      reachable: true,
    };
  }

  // by_date — retirement pinned to targetMonths; the lever is the base contribution.
  const shape = input.shape ?? [];
  const targetMonths = input.targetMonths ?? 0;
  const retirementMonthIndex = clamp(targetMonths, 0, horizonMonthIndex);
  const unreachable = (phases: ContributionPhase[], success: number): SolveDepletionResult => ({
    retirementMonthIndex,
    fireNumber: balanceAtMonth(currentInvested, phases, r, retirementMonthIndex),
    monthsToFire: Infinity,
    horizonMonthIndex,
    successProbability: success,
    reachable: false,
    baseContribution: Infinity,
    phases: resolvePhases(shape, 0),
  });

  if (targetMonths <= 0) return unreachable(resolvePhases(shape, 0), 0);

  const atContribution = (c: number) => {
    const phases = resolvePhases(shape, c);
    return { phases, ...evalAt(phases, retirementMonthIndex) };
  };

  // Growth of today's capital alone already sustains the drawdown — no contributions.
  const zero = atContribution(0);
  if (zero.p50 > 0) {
    return {
      retirementMonthIndex,
      fireNumber: balanceAtMonth(currentInvested, zero.phases, r, retirementMonthIndex),
      monthsToFire: targetMonths,
      horizonMonthIndex,
      successProbability: zero.success,
      reachable: true,
      baseContribution: 0,
      phases: zero.phases,
    };
  }

  // Upper bound: the contribution that funds the FULL perpetuity number by the date
  // (strictly over-funds any finite-horizon spend-down), widened defensively.
  let hi = solveBaseContributionForDate({
    currentInvested,
    monthlyRealReturn: r,
    fireNumber: perpetuity,
    targetMonths,
    shape,
  });
  if (!Number.isFinite(hi)) return unreachable(resolvePhases(shape, 0), 0);

  let hiEval = atContribution(hi);
  for (let guard = 0; hiEval.p50 <= 0 && guard < 6; guard++) {
    hi *= 2;
    hiEval = atContribution(hi);
  }
  if (hiEval.p50 <= 0) return unreachable(hiEval.phases, hiEval.success);

  let lo = 0; // p50 ≤ 0
  let last = hiEval;
  for (let i = 0; i < 14 && (hi - lo) / hi > 1e-3; i++) {
    const mid = (lo + hi) / 2;
    const e = atContribution(mid);
    if (e.p50 > 0) {
      hi = mid;
      last = e;
    } else {
      lo = mid;
    }
  }

  const baseContribution = hi;
  const phases = resolvePhases(shape, baseContribution);
  return {
    retirementMonthIndex,
    fireNumber: balanceAtMonth(currentInvested, phases, r, retirementMonthIndex),
    monthsToFire: targetMonths,
    horizonMonthIndex,
    successProbability: last.success,
    reachable: true,
    baseContribution,
    phases,
  };
}
