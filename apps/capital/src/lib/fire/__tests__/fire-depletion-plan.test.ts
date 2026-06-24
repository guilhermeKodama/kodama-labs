import { describe, it, expect } from 'vitest';
import type { ContributionPhase, FireAssumptions } from '../types';
import { toMonthlyRate } from '../rates';
import { runMonteCarlo, MC_SEED } from '../monte-carlo';
import { resolveDepletion } from '../target';
import { solveBaseContributionForDate } from '../solve';
import { buildPhaseShape } from '../profiles';
import { solveDepletionPlan, type SolveDepletionInput, type SolveDepletionResult } from '../depletion-plan';

const TRIALS = 1000;

/** The full display Monte Carlo the client/server would render for a resolved plan. */
function displayMC(input: SolveDepletionInput, plan: SolveDepletionResult) {
  const a: FireAssumptions = {
    currentInvested: input.currentInvested,
    targetMonthlyIncome: input.targetMonthlyIncome,
    safeWithdrawalRate: input.safeWithdrawalRate,
    realAnnualReturn: input.realAnnualReturn,
    phases: plan.phases ?? input.phases ?? [],
    withdrawalStrategy: 'depletion',
  };
  return runMonteCarlo(a, {
    currentAge: input.currentAge,
    lifeExpectancyAge: input.lifeExpectancyAge,
    annualVolatility: input.annualVolatility,
    retirementMonthIndex: plan.retirementMonthIndex,
    trials: TRIALS,
    seed: input.seed ?? MC_SEED,
    successCriterion: 'positive_at_end',
  });
}

const p50s = (mc: ReturnType<typeof runMonteCarlo>) => mc.points.map((p) => p.p50);
const peakP50 = (mc: ReturnType<typeof runMonteCarlo>) => Math.max(...p50s(mc));
const lastP50 = (mc: ReturnType<typeof runMonteCarlo>) => mc.points[mc.points.length - 1].p50;

const byContribution = (over: Partial<SolveDepletionInput> = {}): SolveDepletionInput => ({
  currentInvested: 200_000,
  targetMonthlyIncome: 10_000,
  safeWithdrawalRate: 0.035,
  realAnnualReturn: 0.05,
  annualVolatility: 0.12,
  currentAge: 40,
  lifeExpectancyAge: 90,
  planningMode: 'by_contribution',
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
  ...over,
});

// ============================================================
// by_contribution — the median spends down to ~0 at life expectancy
// ============================================================
describe('solveDepletionPlan — by_contribution', () => {
  const combos: Array<{ name: string; input: SolveDepletionInput }> = [
    { name: 'baseline (40→90, σ0.12)', input: byContribution() },
    { name: 'low vol (50→85, σ0.08)', input: byContribution({ currentAge: 50, lifeExpectancyAge: 85, annualVolatility: 0.08 }) },
    {
      name: 'long retirement (35→95, σ0.15, big contrib)',
      input: byContribution({
        currentAge: 35,
        lifeExpectancyAge: 95,
        annualVolatility: 0.15,
        currentInvested: 100_000,
        phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 8_000 }],
      }),
    },
  ];

  for (const { name, input } of combos) {
    it(`median depletes to ~0 at life expectancy and ~50% leave a surplus — ${name}`, () => {
      const plan = solveDepletionPlan(input);
      expect(plan.reachable).toBe(true);
      const mc = displayMC(input, plan);
      // The cyan median line ends near zero at the horizon (a small fraction of its peak)…
      expect(lastP50(mc)).toBeLessThan(peakP50(mc) * 0.1);
      // …and ~half the random paths still leave a surplus (the die-with-zero point).
      expect(mc.successProbability).toBeGreaterThanOrEqual(0.4);
      expect(mc.successProbability).toBeLessThanOrEqual(0.6);
      // It does NOT deplete early: a few years before life expectancy the median is still well positive.
      const years = mc.points.length - 1;
      expect(mc.points[years - 5].p50).toBeGreaterThan(peakP50(mc) * 0.15);
    });
  }
});

// ============================================================
// Life-expectancy tracking — the zero-crossing moves with the setting
// ============================================================
describe('solveDepletionPlan — life-expectancy tracking', () => {
  for (const lifeExpectancyAge of [75, 85, 95]) {
    it(`horizon and median zero-crossing track lifeExpectancyAge=${lifeExpectancyAge}`, () => {
      const input = byContribution({ currentAge: 45, lifeExpectancyAge, annualVolatility: 0.1 });
      const plan = solveDepletionPlan(input);
      expect(plan.horizonMonthIndex).toBe(Math.ceil((lifeExpectancyAge - 45) * 12));
      const mc = displayMC(input, plan);
      // Median ~0 at the final (life-expectancy) point.
      expect(lastP50(mc)).toBeLessThan(peakP50(mc) * 0.1);
      // The final plotted age equals life expectancy.
      expect(mc.points[mc.points.length - 1].age).toBe(lifeExpectancyAge);
    });
  }

  it('later life expectancy needs a bigger nest egg / later retirement', () => {
    const shorter = solveDepletionPlan(byContribution({ currentAge: 45, lifeExpectancyAge: 75 }));
    const longer = solveDepletionPlan(byContribution({ currentAge: 45, lifeExpectancyAge: 95 }));
    expect(longer.fireNumber).toBeGreaterThan(shorter.fireNumber);
    expect(longer.retirementMonthIndex).toBeGreaterThanOrEqual(shorter.retirementMonthIndex);
  });
});

// ============================================================
// by_date — retirement pinned to the chosen year; contribution is solved
// ============================================================
describe('solveDepletionPlan — by_date', () => {
  const byDate = (over: Partial<SolveDepletionInput> = {}): SolveDepletionInput => ({
    currentInvested: 150_000,
    targetMonthlyIncome: 8_000,
    safeWithdrawalRate: 0.035,
    realAnnualReturn: 0.05,
    annualVolatility: 0.12,
    currentAge: 40,
    lifeExpectancyAge: 90,
    planningMode: 'by_date',
    shape: buildPhaseShape('front_loaded'),
    targetMonths: 20 * 12, // retire in 20 years
    ...over,
  });

  it('prescribes a finite contribution whose median depletes to ~0 at life expectancy', () => {
    const input = byDate();
    const plan = solveDepletionPlan(input);
    expect(plan.reachable).toBe(true);
    expect(plan.baseContribution).toBeGreaterThan(0);
    expect(Number.isFinite(plan.baseContribution!)).toBe(true);
    expect(plan.phases).toBeTruthy();
    expect(plan.retirementMonthIndex).toBe(20 * 12);
    const mc = displayMC(input, plan);
    expect(lastP50(mc)).toBeLessThan(peakP50(mc) * 0.1);
    expect(mc.successProbability).toBeGreaterThanOrEqual(0.4);
    expect(mc.successProbability).toBeLessThanOrEqual(0.6);
  });

  it('a later target year (less drawdown) needs a smaller prescribed contribution', () => {
    const early = solveDepletionPlan(byDate({ targetMonths: 15 * 12 }));
    const late = solveDepletionPlan(byDate({ targetMonths: 30 * 12 }));
    expect(late.baseContribution!).toBeLessThan(early.baseContribution!);
  });
});

// ============================================================
// σ = 0 — coincides with the exact die-with-zero annuity
// ============================================================
describe('solveDepletionPlan — zero volatility coincides with the exact annuity', () => {
  it('by_contribution matches resolveDepletion at σ=0', () => {
    const input = byContribution({ annualVolatility: 0 });
    const plan = solveDepletionPlan(input);
    const r = toMonthlyRate(input.realAnnualReturn);
    const d = resolveDepletion(
      {
        currentInvested: input.currentInvested,
        targetMonthlyIncome: input.targetMonthlyIncome,
        safeWithdrawalRate: input.safeWithdrawalRate,
        realAnnualReturn: input.realAnnualReturn,
        phases: input.phases!,
        withdrawalStrategy: 'depletion',
      },
      { currentAge: input.currentAge, lifeExpectancyAge: input.lifeExpectancyAge, annualVolatility: 0 },
      r
    );
    expect(plan.fireNumber).toBeCloseTo(d.fireNumber, 4);
    expect(plan.retirementMonthIndex).toBe(d.retirementMonthIndex);
  });

  it('by_date matches the closed-form contribution at σ=0', () => {
    const shape = buildPhaseShape('constant');
    const input: SolveDepletionInput = {
      currentInvested: 150_000,
      targetMonthlyIncome: 8_000,
      safeWithdrawalRate: 0.035,
      realAnnualReturn: 0.05,
      annualVolatility: 0,
      currentAge: 40,
      lifeExpectancyAge: 90,
      planningMode: 'by_date',
      shape,
      targetMonths: 20 * 12,
    };
    const plan = solveDepletionPlan(input);
    const r = toMonthlyRate(input.realAnnualReturn);
    const expected = solveBaseContributionForDate({
      currentInvested: input.currentInvested,
      monthlyRealReturn: r,
      fireNumber: plan.fireNumber,
      targetMonths: input.targetMonths!,
      shape,
    });
    expect(plan.baseContribution).toBeCloseTo(expected, 4);
  });
});

// ============================================================
// Determinism — same seed/inputs ⇒ identical plan
// ============================================================
describe('solveDepletionPlan — determinism', () => {
  it('is bit-identical for the same inputs (by_contribution)', () => {
    const input = byContribution();
    expect(solveDepletionPlan(input)).toEqual(solveDepletionPlan(input));
  });

  it('is bit-identical for the same inputs (by_date)', () => {
    const input: SolveDepletionInput = {
      currentInvested: 150_000,
      targetMonthlyIncome: 8_000,
      safeWithdrawalRate: 0.035,
      realAnnualReturn: 0.05,
      annualVolatility: 0.12,
      currentAge: 40,
      lifeExpectancyAge: 90,
      planningMode: 'by_date',
      shape: buildPhaseShape('front_loaded'),
      targetMonths: 20 * 12,
    };
    expect(solveDepletionPlan(input)).toEqual(solveDepletionPlan(input));
  });
});

// ============================================================
// Server ↔ client agreement — re-running the resolved plan reproduces it
// ============================================================
describe('solveDepletionPlan — server↔client agreement', () => {
  it('the client display MC at the resolved retirement month reproduces the solved success (by_contribution)', () => {
    const input = byContribution();
    const plan = solveDepletionPlan(input);
    const mc = displayMC(input, plan);
    // The server resolves retirementMonthIndex; the client pins it and re-runs the
    // same seeded MC ⇒ identical success and a median at ~0 at life expectancy.
    expect(mc.successProbability).toBe(plan.successProbability);
    expect(lastP50(mc)).toBeLessThan(peakP50(mc) * 0.1);
  });

  it('the client display MC reproduces the solved success (by_date)', () => {
    const input: SolveDepletionInput = {
      currentInvested: 150_000,
      targetMonthlyIncome: 8_000,
      safeWithdrawalRate: 0.035,
      realAnnualReturn: 0.05,
      annualVolatility: 0.12,
      currentAge: 40,
      lifeExpectancyAge: 90,
      planningMode: 'by_date',
      shape: buildPhaseShape('front_loaded'),
      targetMonths: 22 * 12,
    };
    const plan = solveDepletionPlan(input);
    const mc = displayMC(input, plan);
    expect(mc.successProbability).toBe(plan.successProbability);
    expect(lastP50(mc)).toBeLessThan(peakP50(mc) * 0.1);
  });
});

// ============================================================
// Perpetuity contrast — the median sustains (it is not consumed)
// ============================================================
describe('perpetuity sustains where depletion is consumed', () => {
  it('perpetuity median never depletes and success is high', () => {
    const phases: ContributionPhase[] = [{ fromMonth: 0, toMonth: null, monthlyContribution: 6_000 }];
    const a: FireAssumptions = {
      currentInvested: 300_000,
      targetMonthlyIncome: 8_000,
      safeWithdrawalRate: 0.035,
      realAnnualReturn: 0.05,
      phases,
      withdrawalStrategy: 'perpetuity',
    };
    const mc = runMonteCarlo(a, {
      currentAge: 40,
      lifeExpectancyAge: 90,
      annualVolatility: 0.12,
      trials: TRIALS,
      seed: MC_SEED,
      successCriterion: 'never_depleted',
    });
    expect(Math.min(...p50s(mc))).toBeGreaterThan(0);
    expect(mc.successProbability).toBeGreaterThan(0.8);
  });
});
