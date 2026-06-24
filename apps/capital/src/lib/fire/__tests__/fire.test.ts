import { describe, it, expect } from 'vitest';
import type { FireAssumptions, PhaseShape } from '../types';
import { MONTHS_PER_YEAR, RATE_EPSILON, toMonthlyRate, toRealReturn } from '../rates';
import { computeFireNumber, monthsToReach } from '../fire-number';
import { phaseEndingBalance, monthsToFirePhased } from '../phases';
import { solveBaseContributionForDate } from '../solve';
import { buildPhaseShape, resolvePhases } from '../profiles';
import { computeCoastNumber, computeCoastFire } from '../coast';
import { buildProjection } from '../projection';
import { computeScenarios } from '../scenarios';
import { computeTiers } from '../tiers';
import { computeSavingsRate, yearsToFiFromSavingsRate } from '../savings';
import { computeFireResult } from '../result';
import { projectFireDate } from '../dates';

// Shared assumptions used across blocks.
const base: FireAssumptions = {
  currentInvested: 200_000,
  targetMonthlyIncome: 10_000,
  safeWithdrawalRate: 0.035,
  realAnnualReturn: 0.05,
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
};

// ============================================================
// rates
// ============================================================
describe('rates', () => {
  it('toMonthlyRate is geometric (NOT arithmetic r/12)', () => {
    expect(toMonthlyRate(0.05)).toBeCloseTo(0.0040741, 6);
    expect(toMonthlyRate(0)).toBe(0);
  });

  it('toMonthlyRate round-trips back to the annual rate', () => {
    const r = toMonthlyRate(0.07);
    expect(Math.pow(1 + r, MONTHS_PER_YEAR) - 1).toBeCloseTo(0.07, 9);
  });

  it('toRealReturn deflates nominal by inflation', () => {
    expect(toRealReturn(0.1, 0.045)).toBeCloseTo(1.1 / 1.045 - 1, 9);
  });
});

// ============================================================
// FIRE number
// ============================================================
describe('computeFireNumber', () => {
  it('is the 25x rule at 4%', () => {
    expect(computeFireNumber(120_000, 0.04)).toBe(3_000_000);
  });

  it('is ~28.57x at the BR-default 3.5%', () => {
    expect(computeFireNumber(120_000, 0.035)).toBeCloseTo(3_428_571.43, 2);
  });

  it('throws on a non-positive withdrawal rate', () => {
    expect(() => computeFireNumber(120_000, 0)).toThrow();
  });
});

// ============================================================
// monthsToReach — single contribution stream
// ============================================================
describe('monthsToReach', () => {
  it('matches the regression anchor (catches convention drift)', () => {
    const r = toMonthlyRate(0.05);
    const F = computeFireNumber(120_000, 0.035);
    // Geometric + end-of-period => ~290.85. Arithmetic r/12 would give ~287.6.
    expect(monthsToReach(200_000, 5_000, r, F)).toBeCloseTo(290.85, 0);
  });

  it('returns 0 when already reached', () => {
    expect(monthsToReach(4_000_000, 1_000, toMonthlyRate(0.05), 3_000_000)).toBe(0);
  });

  it('handles the r -> 0 linear branch exactly and continuously', () => {
    expect(monthsToReach(100_000, 10_000, 0, 400_000)).toBe(30);
    expect(monthsToReach(100_000, 10_000, RATE_EPSILON / 10, 400_000)).toBeCloseTo(30, 3);
  });

  it('returns Infinity when contributions and growth can never reach', () => {
    expect(monthsToReach(10_000, 0, 0, 1_000_000)).toBe(Infinity);
    expect(monthsToReach(10_000, 0, toMonthlyRate(-0.03), 1_000_000)).toBe(Infinity);
  });

  it('respects the negative-return asymptote (-c/r), not just sign of r', () => {
    // asymptote balance = -c/r = 100_000
    expect(monthsToReach(10_000, 1_000, -0.01, 50_000)).toBeGreaterThan(0); // below asymptote => finite
    expect(monthsToReach(10_000, 1_000, -0.01, 150_000)).toBe(Infinity); // above asymptote => never
  });
});

// ============================================================
// phases
// ============================================================
describe('phases', () => {
  it('phaseEndingBalance compounds a phase (linear when r≈0)', () => {
    expect(phaseEndingBalance(1_000, 100, 12, 0)).toBe(2_200);
    expect(phaseEndingBalance(0, 100, 12, 0.01)).toBeCloseTo(1_268.25, 2);
  });

  it('single open-ended phase equals monthsToReach', () => {
    const r = toMonthlyRate(0.05);
    const F = computeFireNumber(120_000, 0.035);
    const phased = monthsToFirePhased(
      200_000,
      [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
      r,
      F
    );
    expect(phased).toBeCloseTo(monthsToReach(200_000, 5_000, r, F), 6);
  });

  it('chains phases: contribute then stop, crossing happens in phase 2', () => {
    const r = toMonthlyRate(0.05);
    const F = 300_000;
    const P = 100_000;
    const phases = [
      { fromMonth: 0, toMonth: 12, monthlyContribution: 10_000 },
      { fromMonth: 12, toMonth: null, monthlyContribution: 0 },
    ];
    // not reached during phase 1
    expect(monthsToReach(P, 10_000, r, F)).toBeGreaterThan(12);
    const balanceAfter12 = phaseEndingBalance(P, 10_000, 12, r);
    const expected = 12 + monthsToReach(balanceAfter12, 0, r, F);
    expect(monthsToFirePhased(P, phases, r, F)).toBeCloseTo(expected, 6);
  });
});

// ============================================================
// solve — by date => required base contribution
// ============================================================
describe('solveBaseContributionForDate', () => {
  it('produces a contribution that reaches FIRE exactly at the target date', () => {
    const r = toMonthlyRate(0.05);
    const F = computeFireNumber(120_000, 0.035);
    const N = 240; // 20 years
    const shape: PhaseShape[] = buildPhaseShape('front_loaded');
    const c0 = solveBaseContributionForDate({
      currentInvested: 200_000,
      monthlyRealReturn: r,
      fireNumber: F,
      targetMonths: N,
      shape,
    });
    expect(c0).toBeGreaterThan(0);

    const phases = resolvePhases(shape, c0);
    const proj = buildProjection(
      { ...base, phases, safeWithdrawalRate: 0.035, targetMonthlyIncome: 10_000, realAnnualReturn: 0.05 },
      { samplingEveryMonths: 1 }
    );
    const atTarget = proj.points.find((p) => p.monthIndex === N)!;
    expect(Math.abs(atTarget.investedValue - F) / F).toBeLessThan(1e-6);

    // and the phased solver agrees the crossing is at ~N
    expect(monthsToFirePhased(200_000, phases, r, F)).toBeCloseTo(N, 0);
  });

  it('returns 0 when growth alone already reaches the target by the date', () => {
    const r = toMonthlyRate(0.05);
    const c0 = solveBaseContributionForDate({
      currentInvested: 5_000_000,
      monthlyRealReturn: r,
      fireNumber: 3_000_000,
      targetMonths: 120,
      shape: buildPhaseShape('constant'),
    });
    expect(c0).toBe(0);
  });
});

// ============================================================
// profiles
// ============================================================
describe('profiles', () => {
  it('front_loaded is rigorous early then eases off', () => {
    const shape = buildPhaseShape('front_loaded');
    expect(shape.map((s) => s.intensity)).toEqual([1.5, 1.0, 0.7]);
    const phases = resolvePhases(shape, 1_000);
    expect(phases[0].monthlyContribution).toBeGreaterThan(phases[1].monthlyContribution);
    expect(phases[1].monthlyContribution).toBeGreaterThan(phases[2].monthlyContribution);
  });

  it('constant is flat', () => {
    expect(buildPhaseShape('constant').map((s) => s.intensity)).toEqual([1, 1, 1]);
  });
});

// ============================================================
// coast
// ============================================================
describe('coast', () => {
  it('coastNumber discounts the FIRE number by growth', () => {
    const r = toMonthlyRate(0.05);
    expect(computeCoastNumber(3_000_000, r, 240)).toBeCloseTo(3_000_000 / Math.pow(1 + r, 240), 6);
  });

  it('reached when current invested clears the coast number', () => {
    const res = computeCoastFire(
      { ...base, currentInvested: 1_200_000, targetMonthlyIncome: 8_750, safeWithdrawalRate: 0.035 },
      240
    );
    // F = 8750*12/0.035 = 3,000,000
    expect(res.coastNumber).toBeLessThan(3_000_000);
    expect(res.reached).toBe(true);
  });

  it('m=0 gives coastNumber=F; r<=0 makes coasting impossible', () => {
    expect(computeCoastNumber(3_000_000, 0.004, 0)).toBe(3_000_000);
    expect(computeCoastNumber(3_000_000, -0.001, 120)).toBeGreaterThan(3_000_000);
  });
});

// ============================================================
// projection
// ============================================================
describe('buildProjection', () => {
  it('decomposes invested into contributions + growth at every point', () => {
    const proj = buildProjection(base, { samplingEveryMonths: 1 });
    for (const p of proj.points) {
      expect(p.contributionsToDate + p.growthToDate).toBeCloseTo(p.investedValue, 6);
    }
  });

  it('reachedFire flips exactly once and never back', () => {
    const proj = buildProjection(base);
    let flips = 0;
    for (let i = 1; i < proj.points.length; i++) {
      if (proj.points[i].reachedFire !== proj.points[i - 1].reachedFire) flips++;
      if (proj.points[i - 1].reachedFire) expect(proj.points[i].reachedFire).toBe(true);
    }
    expect(flips).toBe(1);
    expect(proj.points[proj.points.length - 1].investedValue).toBeGreaterThanOrEqual(proj.fireNumber);
  });

  it('caps the horizon and emits no NaN/Infinity when never reachable', () => {
    const proj = buildProjection(
      { ...base, currentInvested: 1_000, realAnnualReturn: -0.05, phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 0 }] },
      { maxHorizonMonths: 120 }
    );
    expect(proj.monthsToFire).toBe(Infinity);
    expect(proj.points.length).toBeLessThanOrEqual(121);
    for (const p of proj.points) expect(Number.isFinite(p.investedValue)).toBe(true);
  });
});

// ============================================================
// scenarios
// ============================================================
describe('computeScenarios', () => {
  it('orders pessimistic >= realistic >= optimistic (in months)', () => {
    const [pess, real, opt] = computeScenarios(base);
    expect(pess.monthsToFire).toBeGreaterThanOrEqual(real.monthsToFire);
    expect(real.monthsToFire).toBeGreaterThanOrEqual(opt.monthsToFire);
  });

  it('a pessimistic scenario can be unreachable while others are finite', () => {
    const hard: FireAssumptions = {
      currentInvested: 10_000,
      targetMonthlyIncome: 10_000,
      safeWithdrawalRate: 0.035,
      realAnnualReturn: 0.01,
      phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 1_000 }],
    };
    const [pess, real, opt] = computeScenarios(hard); // pessimistic real = -0.01
    expect(pess.monthsToFire).toBe(Infinity);
    expect(Number.isFinite(real.monthsToFire)).toBe(true);
    expect(Number.isFinite(opt.monthsToFire)).toBe(true);
  });
});

// ============================================================
// tiers
// ============================================================
describe('computeTiers', () => {
  it('scales the FIRE number by the lifestyle multiplier (SWR cancels)', () => {
    const tiers = computeTiers(base);
    const regular = tiers.find((t) => t.tier === 'regular')!;
    const lean = tiers.find((t) => t.tier === 'lean')!;
    const fat = tiers.find((t) => t.tier === 'fat')!;
    expect(lean.fireNumber / regular.fireNumber).toBeCloseTo(0.7, 9);
    expect(fat.fireNumber / regular.fireNumber).toBeCloseTo(1.6, 9);
  });

  it('adds a Barista tier covering only the gap above part-time income', () => {
    const tiers = computeTiers(base, { baristaMonthlyIncome: 4_000 });
    const barista = tiers.find((t) => t.tier === 'barista')!;
    // effective income = 10000 - 4000 = 6000 => F = 6000*12/0.035
    expect(barista.fireNumber).toBeCloseTo((6_000 * 12) / 0.035, 2);
  });
});

// ============================================================
// savings
// ============================================================
describe('savings', () => {
  it('computes savings rate, null on zero income', () => {
    expect(computeSavingsRate(4_000, 10_000)).toBe(0.4);
    expect(computeSavingsRate(4_000, 0)).toBeNull();
  });

  it('years-to-FI from savings rate agrees with the core solver', () => {
    const r = toMonthlyRate(0.05);
    const F = computeFireNumber(0.5 * 120_000, 0.04); // 50% saved => live on half
    const expected = monthsToReach(0, 5_000, r, F) / 12;
    expect(yearsToFiFromSavingsRate(0.5, 120_000, { safeWithdrawalRate: 0.04, realAnnualReturn: 0.05 })).toBeCloseTo(
      expected,
      6
    );
  });
});

// ============================================================
// result — headline + progress identity
// ============================================================
describe('computeFireResult', () => {
  it('passive income and income-progress are consistent with asset progress', () => {
    const res = computeFireResult(base);
    expect(res.currentMonthlyPassiveIncome).toBeCloseTo((200_000 * 0.035) / 12, 6);
    const incomeProgress = res.currentMonthlyPassiveIncome / base.targetMonthlyIncome;
    expect(incomeProgress).toBeCloseTo(res.progress, 9);
  });

  it('reports progress > 1 and reached when already past the FIRE number', () => {
    const res = computeFireResult({ ...base, currentInvested: 4_000_000, targetMonthlyIncome: 10_000, safeWithdrawalRate: 0.04 });
    // F = 3,000,000
    expect(res.reached).toBe(true);
    expect(res.progress).toBeCloseTo(4_000_000 / 3_000_000, 6);
    expect(res.monthsToFire).toBe(0);
  });
});

// ============================================================
// dates
// ============================================================
describe('projectFireDate', () => {
  it('advances by whole months and returns null for Infinity', () => {
    const start = new Date('2026-06-01T00:00:00Z');
    const d = projectFireDate(start, 12)!;
    expect(d.getUTCFullYear()).toBe(2027);
    expect(projectFireDate(start, Infinity)).toBeNull();
  });
});
