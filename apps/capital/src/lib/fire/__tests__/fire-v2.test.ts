import { describe, it, expect } from 'vitest';
import type { FireAssumptions } from '../types';
import { toMonthlyRate } from '../rates';
import { computeFireNumber } from '../fire-number';
import { phaseEndingBalance, monthsToFirePhased } from '../phases';
import { buildLifecycle, type LifecyclePoint } from '../lifecycle';
import { mulberry32, nextNormal, runMonteCarlo } from '../monte-carlo';
import { evaluateMilestones, type MilestoneContext } from '../milestones';

const base: FireAssumptions = {
  currentInvested: 200_000,
  targetMonthlyIncome: 10_000,
  safeWithdrawalRate: 0.035,
  realAnnualReturn: 0.05,
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
};

// ============================================================
// lifecycle
// ============================================================
describe('buildLifecycle', () => {
  it('throws when life expectancy does not exceed current age', () => {
    expect(() => buildLifecycle(base, { currentAge: 90, lifeExpectancyAge: 90 })).toThrow();
  });

  it('accumulation matches the closed-form FV (pure accumulation)', () => {
    const life = buildLifecycle(base, {
      currentAge: 40,
      lifeExpectancyAge: 90,
      retirementTrigger: 'age',
      retirementAge: 90, // = horizon => never withdraws
    });
    const r = toMonthlyRate(0.05);
    const y1 = life.points.find((p) => p.monthIndex === 12)!;
    expect(y1.phase).toBe('accumulation');
    expect(y1.netWorth).toBeCloseTo(phaseEndingBalance(200_000, 5_000, 12, r), 4);
    expect(life.depleted).toBe(false);
  });

  it('the growth identity holds at every point', () => {
    const life = buildLifecycle(base, { currentAge: 40, lifeExpectancyAge: 90 });
    for (const p of life.points) {
      expect(p.growthToDate).toBeCloseTo(p.netWorth - p.contributionsToDate + p.withdrawalsToDate, 6);
    }
  });

  it('retires at the FIRE crossing by default', () => {
    const life = buildLifecycle(base, { currentAge: 40, lifeExpectancyAge: 90 });
    const m = monthsToFirePhased(200_000, base.phases, toMonthlyRate(0.05), computeFireNumber(120_000, 0.035));
    expect(life.retirementMonthIndex).toBe(Math.ceil(m));
    expect(life.fireReached).toBe(true);
  });

  it('floors at zero on depletion and stops paying withdrawals', () => {
    const broke: FireAssumptions = {
      currentInvested: 100_000,
      targetMonthlyIncome: 10_000,
      safeWithdrawalRate: 0.04,
      realAnnualReturn: 0,
      phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 0 }],
    };
    const life = buildLifecycle(broke, { currentAge: 60, lifeExpectancyAge: 90, retirementMonthIndex: 0 });
    expect(life.depleted).toBe(true);
    expect(life.depletionMonthIndex).toBe(10); // 100k / 10k = 10 months at r=0
    expect(life.points[life.points.length - 1].netWorth).toBe(0);
    const y1 = life.points.find((p) => p.monthIndex === 12)!;
    expect(y1.withdrawalsToDate).toBeCloseTo(100_000, 6); // only paid what existed
    expect(y1.netWorth).toBe(0);
  });
});

// ============================================================
// monte carlo
// ============================================================
describe('monte carlo', () => {
  it('PRNG is deterministic and in range', () => {
    const a = mulberry32(42);
    const x1 = a();
    const x2 = a();
    const b = mulberry32(42);
    expect(b()).toBe(x1);
    expect(b()).toBe(x2);
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThan(1);
  });

  it('nextNormal is ~ Normal(0,1)', () => {
    const rng = mulberry32(123);
    const N = 100_000;
    let sum = 0;
    let sumsq = 0;
    for (let i = 0; i < N; i++) {
      const x = nextNormal(rng);
      sum += x;
      sumsq += x * x;
    }
    const mean = sum / N;
    const sd = Math.sqrt(sumsq / N - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });

  const mcOpts = {
    currentAge: 40,
    lifeExpectancyAge: 90,
    annualVolatility: 0.12,
    trials: 500,
    seed: 7,
  };

  it('is reproducible for the same seed and inputs', () => {
    const a = runMonteCarlo(base, mcOpts);
    const b = runMonteCarlo(base, mcOpts);
    expect(a.successProbability).toBe(b.successProbability);
    expect(JSON.stringify(a.points)).toBe(JSON.stringify(b.points));
  });

  it('keeps percentiles ordered and non-negative every year', () => {
    const { points } = runMonteCarlo(base, mcOpts);
    for (const p of points) {
      expect(p.p10).toBeLessThanOrEqual(p.p25);
      expect(p.p25).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p75).toBeLessThanOrEqual(p.p90);
      expect(p.p10).toBeGreaterThanOrEqual(0);
    }
  });

  it('year 0 is deterministic at the current invested', () => {
    const { points } = runMonteCarlo(base, mcOpts);
    const y0 = points[0];
    expect(y0.p10).toBe(200_000);
    expect(y0.p90).toBe(200_000);
  });

  it('zero volatility collapses the band; positive volatility widens it', () => {
    const flat = runMonteCarlo(base, { ...mcOpts, annualVolatility: 0 });
    const flatLast = flat.points[flat.points.length - 1];
    expect(flatLast.p90 - flatLast.p10).toBeCloseTo(0, 6);

    const noisy = runMonteCarlo(base, { ...mcOpts, annualVolatility: 0.15, trials: 2000 });
    const noisyLast = noisy.points[noisy.points.length - 1];
    expect(noisyLast.p90 - noisyLast.p10).toBeGreaterThan(0);
  });

  it('success is non-decreasing in return (pathwise, same seed)', () => {
    const a: FireAssumptions = {
      currentInvested: 700_000,
      targetMonthlyIncome: 3_000,
      safeWithdrawalRate: 0.04,
      realAnnualReturn: 0.02,
      phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 2_000 }],
    };
    const opts = { currentAge: 50, lifeExpectancyAge: 85, annualVolatility: 0.12, trials: 500, seed: 9 };
    const low = runMonteCarlo(a, opts);
    const high = runMonteCarlo({ ...a, realAnnualReturn: 0.06 }, opts);
    expect(high.successProbability).toBeGreaterThanOrEqual(low.successProbability);
  });

  it('pure accumulation always succeeds', () => {
    const res = runMonteCarlo(base, {
      ...mcOpts,
      retirementMonthIndex: 100_000, // clamped beyond the horizon => never withdraws
    });
    expect(res.successProbability).toBe(1);
  });

  it('throws on bad inputs', () => {
    expect(() => runMonteCarlo(base, { ...mcOpts, trials: 0 })).toThrow();
    expect(() => runMonteCarlo(base, { ...mcOpts, currentAge: 90, lifeExpectancyAge: 90 })).toThrow();
  });
});

// ============================================================
// milestones
// ============================================================
describe('evaluateMilestones', () => {
  const life = buildLifecycle(base, { currentAge: 40, lifeExpectancyAge: 90 });
  const ctx: MilestoneContext = {
    annualExpenses: 120_000,
    swr: 0.035,
    currentInvested: 200_000,
    fireNumber: computeFireNumber(120_000, 0.035),
    monthlyRealReturn: toMonthlyRate(0.05),
    retirementMonthIndex: life.retirementMonthIndex,
    currentAge: 40,
  };

  it('net_worth_x_expenses(1/swr) equals the FIRE number', () => {
    const byMultiple = evaluateMilestones(
      [{ id: 'a', name: 'FIRE', type: 'net_worth_x_expenses', value: 1 / 0.035 }],
      life.points,
      ctx
    )[0];
    const byAbsolute = evaluateMilestones(
      [{ id: 'b', name: 'FIRE$', type: 'net_worth_absolute', value: ctx.fireNumber }],
      life.points,
      ctx
    )[0];
    expect(byMultiple.achievedMonthIndex).toBe(byAbsolute.achievedMonthIndex);
    expect(byMultiple.achievedMonthIndex).not.toBeNull();
  });

  it('passive_income_absolute matches the equivalent net-worth threshold', () => {
    const byIncome = evaluateMilestones(
      [{ id: 'a', name: 'Income', type: 'passive_income_absolute', value: 10_000 }],
      life.points,
      ctx
    )[0];
    const byAbsolute = evaluateMilestones(
      [{ id: 'b', name: 'NW', type: 'net_worth_absolute', value: ctx.fireNumber }],
      life.points,
      ctx
    )[0];
    expect(byIncome.achievedMonthIndex).toBe(byAbsolute.achievedMonthIndex);
  });

  it('reports the first crossing and prior point is below', () => {
    const [m] = evaluateMilestones(
      [{ id: 'a', name: 'Half mil', type: 'net_worth_absolute', value: 500_000 }],
      life.points,
      ctx
    );
    expect(m.achievedMonthIndex).not.toBeNull();
    const idx = life.points.findIndex((p) => p.monthIndex === m.achievedMonthIndex);
    expect(life.points[idx].netWorth).toBeGreaterThanOrEqual(500_000);
    if (idx > 0) expect(life.points[idx - 1].netWorth).toBeLessThan(500_000);
  });

  it('age milestone tracks age and progress', () => {
    const [m] = evaluateMilestones([{ id: 'a', name: '65', type: 'age', value: 65 }], life.points, ctx);
    expect(m.achievedAge).not.toBeNull();
    expect(m.achievedAge!).toBeGreaterThanOrEqual(65);
    expect(m.progress).toBeCloseTo(40 / 65, 6);
  });

  it('marks already-reached milestones and clamps progress to 1', () => {
    const [m] = evaluateMilestones(
      [{ id: 'a', name: 'Tiny', type: 'net_worth_absolute', value: 100_000 }],
      life.points,
      ctx
    );
    expect(m.reachedNow).toBe(true);
    expect(m.achievedMonthIndex).toBe(0);
    expect(m.progress).toBe(1);
  });

  it('returns null achievement for unreachable milestones', () => {
    const [m] = evaluateMilestones(
      [{ id: 'a', name: 'Absurd', type: 'net_worth_absolute', value: 1e12 }],
      life.points,
      ctx
    );
    expect(m.achievedMonthIndex).toBeNull();
    expect(m.progress).toBeGreaterThan(0);
    expect(m.progress).toBeLessThan(1);
  });

  it('coast milestone is reached exactly at the coast number', () => {
    const rMonth = toMonthlyRate(0.05);
    const F = 3_000_000;
    const rm = 240;
    const coastNumber = F / Math.pow(1 + rMonth, rm);
    const coastDef = { id: 'c', name: 'Coast', type: 'coast' as const, value: 0 };
    const mkCtx = (invested: number): MilestoneContext => ({
      annualExpenses: 120_000,
      swr: 0.04,
      currentInvested: invested,
      fireNumber: F,
      monthlyRealReturn: rMonth,
      retirementMonthIndex: rm,
      currentAge: 40,
    });
    const mkPath = (nw: number): LifecyclePoint[] => [
      { monthIndex: 0, age: 40, yearOffset: 0, netWorth: nw, phase: 'accumulation', contributionsToDate: nw, withdrawalsToDate: 0, growthToDate: 0 },
    ];
    expect(evaluateMilestones([coastDef], mkPath(coastNumber), mkCtx(coastNumber))[0].reachedNow).toBe(true);
    expect(
      evaluateMilestones([coastDef], mkPath(coastNumber * 0.999), mkCtx(coastNumber * 0.999))[0].reachedNow
    ).toBe(false);
  });

  it('preserves order and handles empty input', () => {
    const out = evaluateMilestones(
      [
        { id: 'x', name: 'X', type: 'net_worth_absolute', value: 1 },
        { id: 'y', name: 'Y', type: 'age', value: 50 },
      ],
      life.points,
      ctx
    );
    expect(out.map((m) => m.id)).toEqual(['x', 'y']);
    expect(evaluateMilestones([], life.points, ctx)).toEqual([]);
  });
});
