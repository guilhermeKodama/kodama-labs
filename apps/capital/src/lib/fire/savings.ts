import { MONTHS_PER_YEAR, toMonthlyRate } from './rates';
import { computeFireNumber, monthsToReach } from './fire-number';

/** Savings rate = contribution / income (null when income is non-positive). */
export function computeSavingsRate(monthlyContribution: number, monthlyIncome: number): number | null {
  if (monthlyIncome <= 0) return null;
  return monthlyContribution / monthlyIncome;
}

/**
 * The classic "years to FI as a function of savings rate" relationship (starting
 * from zero), reusing the core solver: contribute `s·income`, live on the rest,
 * target 25x (or 1/SWR x) of those expenses.
 */
export function yearsToFiFromSavingsRate(
  savingsRate: number,
  annualIncome: number,
  a: { safeWithdrawalRate: number; realAnnualReturn: number }
): number {
  const monthlyIncome = annualIncome / MONTHS_PER_YEAR;
  const contribution = savingsRate * monthlyIncome;
  const annualExpenses = (1 - savingsRate) * annualIncome;
  const fireNumber = computeFireNumber(annualExpenses, a.safeWithdrawalRate);
  const r = toMonthlyRate(a.realAnnualReturn);
  return monthsToReach(0, contribution, r, fireNumber) / MONTHS_PER_YEAR;
}
