import { describe, it, expect } from 'vitest';
import {
  holdingValue,
  computeCurrentInvested,
  computeCurrentMonthlyExpenses,
  computeSuggestedMonthlyContribution,
  computeExpenseGap,
  buildAssumptions,
} from '../adapter';
import { toRealReturn } from '../rates';

describe('holdingValue', () => {
  it('uses market value when price is present', () => {
    expect(holdingValue({ currentQuantity: 10, currentPrice: 25, totalInvested: 200 })).toBe(250);
  });
  it('falls back to cost basis without a price or with zero quantity', () => {
    expect(holdingValue({ currentQuantity: 10, currentPrice: null, totalInvested: 200 })).toBe(200);
    expect(holdingValue({ currentQuantity: 0, currentPrice: 25, totalInvested: 200 })).toBe(200);
  });
});

describe('computeCurrentInvested', () => {
  it('sums market value + cash, converting by currency rate', () => {
    const invested = computeCurrentInvested(
      [
        { currentQuantity: 100, currentPrice: 10, totalInvested: 800, currency: 'BRL' },
        { currentQuantity: 5, currentPrice: 20, totalInvested: 90, currency: 'USD' }, // 100 * 5.5
      ],
      [{ cashBalance: 1_000, currency: 'BRL' }],
      { USD: 5.5 }
    );
    expect(invested).toBe(1_000 /*BRL holding*/ + 550 /*USD holding*/ + 1_000 /*cash*/);
  });

  it('defaults missing currency rates to 1', () => {
    expect(
      computeCurrentInvested([{ currentQuantity: 1, currentPrice: 100, totalInvested: 50 }], [])
    ).toBe(100);
  });
});

describe('computeCurrentMonthlyExpenses', () => {
  const now = new Date('2026-06-15T00:00:00Z');
  it('averages trailing months and excludes the Investment category', () => {
    const expenses = [
      { amount: 3_000, exchangeRate: 1, category: 'Food', date: '2026-06-01' },
      { amount: 3_000, exchangeRate: 1, category: 'Rent', date: '2026-05-01' },
      { amount: 5_000, exchangeRate: 1, category: 'Investment', date: '2026-05-10' }, // excluded
      { amount: 9_999, exchangeRate: 1, category: 'Old', date: '2024-01-01' }, // out of window
    ];
    // (3000 + 3000) / 6 months = 1000
    expect(computeCurrentMonthlyExpenses(expenses, { months: 6, now })).toBe(1_000);
  });

  it('contribution suggestion averages investment outflows', () => {
    const contributions = [
      { amount: 2_000, exchangeRate: 1, category: 'Investment', date: '2026-06-01' },
      { amount: 2_000, exchangeRate: 1, category: 'Investment', date: '2026-05-01' },
    ];
    expect(computeSuggestedMonthlyContribution(contributions, { months: 2, now })).toBe(2_000);
  });
});

describe('computeExpenseGap', () => {
  it('flags when the target is above current lifestyle', () => {
    const gap = computeExpenseGap(12_000, 10_000);
    expect(gap.direction).toBe('above');
    expect(gap.difference).toBe(2_000);
    expect(gap.percentDifference).toBeCloseTo(0.2, 9);
  });
  it('flags below and equal, and handles no baseline', () => {
    expect(computeExpenseGap(8_000, 10_000).direction).toBe('below');
    expect(computeExpenseGap(10_000, 10_000).direction).toBe('equal');
    expect(computeExpenseGap(10_000, 0).percentDifference).toBeNull();
  });
});

describe('buildAssumptions', () => {
  it('deflates the nominal return into a real return', () => {
    const a = buildAssumptions(
      {
        targetMonthlyIncome: 10_000,
        safeWithdrawalRate: 0.035,
        nominalAnnualReturn: 0.1,
        annualInflation: 0.045,
        phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 5_000 }],
      },
      200_000
    );
    expect(a.realAnnualReturn).toBeCloseTo(toRealReturn(0.1, 0.045), 9);
    expect(a.currentInvested).toBe(200_000);
  });
});
