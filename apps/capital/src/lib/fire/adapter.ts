/**
 * Capital adapter for the FIRE engine.
 *
 * This is the ONLY part of the FIRE feature that encodes the Capital domain
 * (holdings, investment cash, expense transactions, FX). It maps that domain
 * into the engine's plain `FireAssumptions`. It deliberately accepts STRUCTURAL
 * inputs (not Prisma rows or `@/types`) so it can be called from the server
 * service (mapping Prisma rows) and the client alike, and stay easy to extract.
 *
 * The engine answers "given these numbers, when do I reach FIRE?"; this adapter
 * answers "what are my numbers?".
 */
import type { ContributionPhase, FireAssumptions, WithdrawalStrategy } from './types';
import { toRealReturn } from './rates';

export interface FireHoldingInput {
  currentQuantity: number;
  currentPrice?: number | null;
  totalInvested: number;
  /** Holding currency; converted to base via `currencyRates`. */
  currency?: string;
}

export interface FireAccountInput {
  cashBalance: number;
  currency?: string;
}

/** A spent transaction (already an expense). `amount` is in `currency`; `exchangeRate` converts to base. */
export interface FireSpendInput {
  amount: number;
  exchangeRate: number;
  category?: string | null;
  date: Date | string;
}

/** The "Investment" category marks expense rows that are really contributions, not consumption. */
export const INVESTMENT_CATEGORY = 'Investment';

/**
 * Market value of a holding, falling back to cost basis when no live price.
 * Mirrors `computeCurrentValue` in holdings-table.tsx, but the table shows "-"
 * with no price whereas the engine needs a number — hence the fallback.
 */
export function holdingValue(h: FireHoldingInput): number {
  if (h.currentPrice && h.currentQuantity > 0) {
    return h.currentQuantity * h.currentPrice;
  }
  return h.totalInvested;
}

const rateFor = (rates: Record<string, number>, currency?: string): number =>
  currency ? rates[currency] ?? 1 : 1;

/**
 * The FIRE base: portfolio market value + investment-account cash, in base
 * currency. `currencyRates` maps a currency code to base-currency-per-unit
 * (missing => 1, i.e. already base).
 */
export function computeCurrentInvested(
  holdings: FireHoldingInput[],
  accounts: FireAccountInput[],
  currencyRates: Record<string, number> = {}
): number {
  const holdingsTotal = holdings.reduce(
    (sum, h) => sum + holdingValue(h) * rateFor(currencyRates, h.currency),
    0
  );
  const cashTotal = accounts.reduce(
    (sum, a) => sum + a.cashBalance * rateFor(currencyRates, a.currency),
    0
  );
  return holdingsTotal + cashTotal;
}

interface TrailingOptions {
  /** Trailing window length in months (default 6). */
  months?: number;
  /** "Now" for testability (default new Date()). */
  now?: Date;
}

function averageMonthly(items: FireSpendInput[], opts: TrailingOptions = {}): number {
  const months = opts.months ?? 6;
  if (months <= 0) return 0;
  const now = opts.now ? new Date(opts.now) : new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);

  let total = 0;
  for (const item of items) {
    const date = new Date(item.date);
    if (date >= start && date <= now) total += item.amount * item.exchangeRate;
  }
  return total / months;
}

/**
 * Average real monthly expenses over the trailing window — the baseline the
 * target income is compared against (the gap). Excludes the "Investment"
 * category, which is a contribution, not consumption.
 */
export function computeCurrentMonthlyExpenses(
  expenses: FireSpendInput[],
  opts: TrailingOptions = {}
): number {
  const consumption = expenses.filter((e) => e.category !== INVESTMENT_CATEGORY);
  return averageMonthly(consumption, opts);
}

/** Suggested default monthly contribution from realized investment outflows. */
export function computeSuggestedMonthlyContribution(
  contributions: FireSpendInput[],
  opts: TrailingOptions = {}
): number {
  return averageMonthly(contributions, opts);
}

export type GapDirection = 'above' | 'below' | 'equal';

export interface ExpenseGap {
  targetMonthlyIncome: number;
  currentMonthlyExpenses: number;
  /** target - current (positive => target is above current lifestyle). */
  difference: number;
  /** (target - current) / current, or null when there is no expense baseline. */
  percentDifference: number | null;
  direction: GapDirection;
}

/**
 * How the desired retirement income compares to what the user actually spends
 * today — the signal that directs "what needs to happen over the years".
 */
export function computeExpenseGap(
  targetMonthlyIncome: number,
  currentMonthlyExpenses: number
): ExpenseGap {
  const difference = targetMonthlyIncome - currentMonthlyExpenses;
  const percentDifference =
    currentMonthlyExpenses > 0 ? difference / currentMonthlyExpenses : null;
  const direction: GapDirection =
    Math.abs(difference) < 1e-6 ? 'equal' : difference > 0 ? 'above' : 'below';
  return { targetMonthlyIncome, currentMonthlyExpenses, difference, percentDifference, direction };
}

export interface FireGoalInputs {
  targetMonthlyIncome: number;
  safeWithdrawalRate: number;
  nominalAnnualReturn: number;
  annualInflation: number;
  monthlyIncome?: number | null;
  phases: ContributionPhase[];
  withdrawalStrategy?: WithdrawalStrategy;
}

/** Assemble engine assumptions: deflate the nominal return by inflation into a real return. */
export function buildAssumptions(goal: FireGoalInputs, currentInvested: number): FireAssumptions {
  return {
    currentInvested,
    targetMonthlyIncome: goal.targetMonthlyIncome,
    safeWithdrawalRate: goal.safeWithdrawalRate,
    realAnnualReturn: toRealReturn(goal.nominalAnnualReturn, goal.annualInflation),
    phases: goal.phases,
    monthlyIncome: goal.monthlyIncome ?? undefined,
    withdrawalStrategy: goal.withdrawalStrategy,
  };
}
