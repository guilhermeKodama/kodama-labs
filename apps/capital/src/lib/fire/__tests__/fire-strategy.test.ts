import { describe, it, expect } from 'vitest';
import type { FireAssumptions } from '../types';
import { toMonthlyRate } from '../rates';
import { computeFireNumber } from '../fire-number';
import { computeFireResult } from '../result';
import { depletionFireNumber, depletionTarget, resolveDepletion } from '../target';
import { buildLifecycle } from '../lifecycle';
import { runMonteCarlo } from '../monte-carlo';

const base: FireAssumptions = {
  currentInvested: 200_000,
  targetMonthlyIncome: 10_000,
  safeWithdrawalRate: 0.035,
  realAnnualReturn: 0.05,
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
};

// ============================================================
// depletionTarget — the annuity present value
// ============================================================
describe('depletionTarget', () => {
  it('is w·n at zero real return', () => {
    expect(depletionTarget(10_000, 0, 360)).toBeCloseTo(10_000 * 360, 6);
  });

  it('exactly funds n end-of-period withdrawals, depleting to ~0', () => {
    const w = 10_000;
    const r = toMonthlyRate(0.05);
    const n = 360;
    let b = depletionTarget(w, r, n);
    for (let m = 0; m < n; m++) b = b * (1 + r) - w; // grow then withdraw (no floor)
    expect(Math.abs(b)).toBeLessThan(1e-3);
  });

  it('grows with the horizon and stays under the monthly perpetuity bound w/r', () => {
    const w = 10_000;
    const r = toMonthlyRate(0.05);
    expect(depletionTarget(w, r, 120)).toBeLessThan(depletionTarget(w, r, 360));
    expect(depletionTarget(w, r, 360)).toBeLessThan(w / r);
  });

  it('approaches the perpetuity value as the horizon grows without bound', () => {
    const w = 10_000;
    const r = toMonthlyRate(0.05);
    expect(depletionTarget(w, r, 12_000)).toBeCloseTo(w / r, 0);
  });
});

// ============================================================
// depletionFireNumber — median (geometric) target
// ============================================================
describe('depletionFireNumber', () => {
  const inputs = { targetMonthlyIncome: 10_000, realAnnualReturn: 0.05, safeWithdrawalRate: 0.035 };

  it('with zero volatility reproduces the exact die-with-zero annuity', () => {
    expect(depletionFireNumber(inputs, 0, 360)).toBeCloseTo(
      depletionTarget(10_000, toMonthlyRate(0.05), 360),
      4
    );
  });

  it('with volatility needs MORE than the expected-return target (volatility drag)', () => {
    const expected = depletionFireNumber(inputs, 0, 360);
    const median = depletionFireNumber(inputs, 0.12, 360);
    expect(median).toBeGreaterThan(expected);
  });

  it('more volatility ⇒ a larger target (more drag)', () => {
    expect(depletionFireNumber(inputs, 0.18, 360)).toBeGreaterThan(
      depletionFireNumber(inputs, 0.08, 360)
    );
  });

  it('matches the annuity priced at the geometric (median) return', () => {
    const geo = 0.05 - (0.12 * 0.12) / 2;
    expect(depletionFireNumber(inputs, 0.12, 360)).toBeCloseTo(
      depletionTarget(10_000, toMonthlyRate(geo), 360),
      4
    );
  });

  it('never exceeds the perpetuity number (capped)', () => {
    const perpetuity = computeFireNumber(inputs.targetMonthlyIncome * 12, inputs.safeWithdrawalRate);
    // High volatility drags the geometric return below the SWR; the cap binds.
    expect(depletionFireNumber(inputs, 0.25, 1200)).toBeLessThanOrEqual(perpetuity + 1e-6);
  });
});

// ============================================================
// resolveDepletion — number + retirement timing
// ============================================================
describe('resolveDepletion', () => {
  const r = toMonthlyRate(base.realAnnualReturn);

  it('needs less capital than the perpetuity number for a finite life', () => {
    const d = resolveDepletion(base, { currentAge: 40, lifeExpectancyAge: 90 }, r);
    const perpetuity = computeFireNumber(base.targetMonthlyIncome * 12, base.safeWithdrawalRate);
    expect(d.fireNumber).toBeGreaterThan(0);
    expect(d.fireNumber).toBeLessThan(perpetuity);
  });

  it('crossing is self-consistent: accumulated balance covers the target', () => {
    const d = resolveDepletion(base, { currentAge: 40, lifeExpectancyAge: 90 }, r);
    let b = base.currentInvested;
    for (let m = 1; m <= d.retirementMonthIndex; m++) {
      b = b * (1 + r) + base.phases[0].monthlyContribution;
    }
    expect(b).toBeGreaterThanOrEqual(d.fireNumber - 1);
  });

  it('a fixed retirement age sizes the target to the remaining horizon', () => {
    const d = resolveDepletion(base, { currentAge: 40, lifeExpectancyAge: 90, retirementAge: 60 }, r);
    const monthsInRetirement = Math.ceil((90 - 60) * 12);
    expect(d.retirementMonthIndex).toBe(Math.round((60 - 40) * 12));
    expect(d.fireNumber).toBeCloseTo(depletionTarget(base.targetMonthlyIncome, r, monthsInRetirement), 4);
  });
});

// ============================================================
// buildLifecycle under the depletion strategy
// ============================================================
describe('buildLifecycle under depletion', () => {
  const dep: FireAssumptions = { ...base, withdrawalStrategy: 'depletion' };

  it('reports the smaller depletion number and draws the balance down', () => {
    const life = buildLifecycle(dep, { currentAge: 40, lifeExpectancyAge: 90 });
    const perpetuity = buildLifecycle(base, { currentAge: 40, lifeExpectancyAge: 90 });
    expect(life.fireNumber).toBeLessThan(perpetuity.fireNumber);

    const peak = Math.max(...life.points.map((p) => p.netWorth));
    const last = life.points[life.points.length - 1];
    expect(last.netWorth).toBeLessThan(peak * 0.3); // significant drawdown by the horizon
  });

  it('net worth at retirement is approximately the depletion target', () => {
    const life = buildLifecycle(dep, { currentAge: 40, lifeExpectancyAge: 90 });
    const atRet = life.points.find((p) => p.monthIndex >= life.retirementMonthIndex)!;
    expect(atRet.netWorth).toBeGreaterThan(life.fireNumber * 0.85);
  });
});

// ============================================================
// Monte Carlo success criteria
// ============================================================
describe('runMonteCarlo success criteria', () => {
  const dep: FireAssumptions = { ...base, withdrawalStrategy: 'depletion' };
  const opts = { currentAge: 40, lifeExpectancyAge: 90, annualVolatility: 0.1, trials: 300, seed: 42 };

  it('lasted_to_horizon is at least as forgiving as never_depleted', () => {
    const lasted = runMonteCarlo(dep, { ...opts, successCriterion: 'lasted_to_horizon' });
    const never = runMonteCarlo(dep, { ...opts, successCriterion: 'never_depleted' });
    expect(lasted.successProbability).toBeGreaterThanOrEqual(never.successProbability);
  });

  it('is deterministic for a fixed seed', () => {
    const a = runMonteCarlo(dep, { ...opts, successCriterion: 'lasted_to_horizon' });
    const b = runMonteCarlo(dep, { ...opts, successCriterion: 'lasted_to_horizon' });
    expect(a.successProbability).toBe(b.successProbability);
  });

  it('draws the median path down toward zero by life expectancy (it is consumed)', () => {
    const mc = runMonteCarlo(dep, { ...opts, trials: 1500, successCriterion: 'lasted_to_horizon' });
    const peak = Math.max(...mc.points.map((p) => p.p50));
    const last = mc.points[mc.points.length - 1].p50;
    expect(last).toBeLessThan(peak * 0.5); // clearly declining, not a stable perpetuity
  });
});

// ============================================================
// computeFireResult headline
// ============================================================
describe('computeFireResult strategy', () => {
  const dep: FireAssumptions = { ...base, withdrawalStrategy: 'depletion' };

  it('depletion needs a smaller number and shows more progress', () => {
    const perp = computeFireResult(base);
    const drawdown = computeFireResult(dep, { currentAge: 40, lifeExpectancyAge: 90 });
    expect(drawdown.fireNumber).toBeLessThan(perp.fireNumber);
    expect(drawdown.progress).toBeGreaterThan(perp.progress);
  });

  it('falls back to the perpetuity number when ages are missing', () => {
    const r = computeFireResult(dep);
    const perpetuity = computeFireNumber(base.targetMonthlyIncome * 12, base.safeWithdrawalRate);
    expect(r.fireNumber).toBeCloseTo(perpetuity, 4);
  });
});
