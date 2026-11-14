/**
 * Budget projections: pure, deterministic, no I/O. The overview loads the
 * history; these functions turn it into a number. Every amount is net
 * (expenses minus income that reimburses the category), the same basis as
 * Gasto. Transfers, investments and aportes are not expenses and never
 * reach this module.
 *
 * Fixed (a bill, once or a few times a month):
 *   max(booked + recurring charges still due, expected month)
 *   The expected month is the recurring charges (the app's recurring rules
 *   and merchants seen in at least three of the last six months), else a
 *   robust level of recent months, else the budget. A charge already booked
 *   this month, within about a third of a pending bill and not claimed by
 *   another bill, is that bill even under a different key. When the last
 *   three months sit well below the gross recurring total, the expected
 *   month is that net level (a bill reimbursed every month). Once the
 *   recurring charges have all posted and the month already holds a typical
 *   amount, it stops at what is booked. It is never scaled by the day.
 *
 * Variable (spend spread through the month):
 *   booked + what usually still arrives after today (median of the last
 *   six months, one high month dropped). One month of history is blended
 *   with the budget for the days that are left. No history: the rest of
 *   the budget, or nothing more without a budget. No daily rate.
 *
 * A later month: robust level of complete months (median, one high month
 * dropped, net credits left out), shrunk to the budget when there is a
 * single month, never negative, never below what is already booked. The
 * same calendar month of two earlier years moves it only when they agree.
 *
 * Trend: median of the last three complete months against the three
 * before them; null ("—") when there is too little data or the change is
 * past +200%.
 */

import { addDays, addMonths } from "date-fns";

export interface HistoryMonth {
  /** Net spend of the whole month. May be negative (refunds). */
  total: number;
  /** Net spend strictly after the day being forecast. May be negative. */
  rest: number;
}

export interface RecurringExpectation {
  /** Typical monthly total of the recurring charges of this series. */
  expected: number;
  /** Of that, what has not posted yet this month. */
  pending: number;
}

export type ProjectionMethod =
  | "fixed_recurring"
  | "fixed_history"
  | "fixed_budget"
  | "fixed_booked"
  | "variable_history"
  | "variable_budget"
  | "variable_booked";

export interface MonthProjectionInput {
  kind: "fixo" | "variavel";
  /** Net spent through today. */
  spent: number;
  /** Net booked for the whole month, rows dated after today included. */
  committed: number;
  /** Budget available this month (amount plus carry); 0 without one. */
  budget: number;
  /** Share of the month already gone (day / days in month). Weighs the budget's prior with one month of history. */
  elapsed?: number;
  /** Up to six complete months before this one, oldest first. A month with no rows is absent, not zero. */
  history: readonly HistoryMonth[];
  recurring?: RecurringExpectation;
}

export interface MonthProjection {
  total: number;
  method: ProjectionMethod;
  /** History months left out as outliers. */
  outlierMonths: number;
}

export interface FutureMonthInput {
  /** Complete months before the one being forecast, oldest first. */
  history: readonly number[];
  /** The same calendar month in earlier years. */
  seasonal?: readonly number[];
  budget: number | null;
  /** Net already booked in that month (installments). */
  committed: number;
}

export interface ChargeObservation {
  /** YYYY-MM. */
  month: string;
  /** Recurring rule id or folded merchant. Never shown. */
  key: string;
  day: number;
  /** Positive spend. */
  amount: number;
}

export interface RecurringBill {
  key: string;
  amount: number;
  day: number;
  seen: number;
  posted: boolean;
  /** Already booked this month under the same key. */
  postedAmount: number;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Median; an even count averages the two central values; empty is 0. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  const lo = sorted[mid - 1] ?? hi;
  return sorted.length % 2 === 1 ? hi : (lo + hi) / 2;
}

/**
 * The highest value left out when it is more than 2.5× the median. Fewer
 * than four points cannot tell an outlier from a real level.
 */
export function dropHighOutlier(values: readonly number[]): { values: number[]; dropped: boolean } {
  if (values.length < 4) return { values: [...values], dropped: false };
  const mid = median(values);
  let maxAt = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] ?? 0) > (values[maxAt] ?? 0)) maxAt = i;
  if (mid > 0 && (values[maxAt] ?? 0) > mid * 2.5) return { values: values.filter((_, i) => i !== maxAt), dropped: true };
  return { values: [...values], dropped: false };
}

/**
 * Typical value of a series. `level` leaves out net-credit months (a
 * refund is not a cheap month); `tail` reads a credit as nothing arriving.
 * One sample is itself, two take the smaller, three or more the median
 * after at most one high outlier is dropped.
 */
export function robustCenter(values: readonly number[], mode: "level" | "tail"): { value: number; dropped: boolean } | null {
  const cleaned = mode === "tail" ? values.map((v) => Math.max(0, v)) : values.filter((v) => v >= 0);
  if (cleaned.length === 0) return null;
  const { values: sample, dropped } = dropHighOutlier(cleaned);
  if (sample.length === 1) return { value: sample[0] ?? 0, dropped };
  if (sample.length === 2) return { value: Math.min(sample[0] ?? 0, sample[1] ?? 0), dropped };
  return { value: median(sample), dropped };
}

/** One month cannot be told from a one-off: more than double the budget, use the budget. */
function shrinkSingle(value: number, budget: number): number {
  return budget > 0 && value > budget * 2 ? budget : value;
}

/**
 * recurring.expected is the gross charge. When the last three complete
 * months are all well below it, the gap is the reimbursement that arrives
 * with the bill, and the expected month is that net level.
 */
function netOfReimbursements(recurring: RecurringExpectation, history: readonly HistoryMonth[]): RecurringExpectation | null {
  const recent = history.slice(-3).map((h) => h.total).filter((v) => v >= 0);
  if (recent.length < 3 || !(recurring.expected > 0)) return null;
  const level = median(recent);
  if (!(level < recurring.expected * 0.7) || !recent.every((v) => v < recurring.expected * 0.85)) return null;
  return { expected: cents(level), pending: cents(Math.max(0, recurring.pending - (recurring.expected - level))) };
}

function projectFixed(input: MonthProjectionInput): MonthProjection {
  const budget = Math.max(0, input.budget);
  const level = robustCenter(input.history.map((h) => h.total), "level");
  const n = input.history.length;
  const fromHistory = level == null ? null : n >= 2 ? level.value : shrinkSingle(level.value, budget);
  const gross = input.recurring ?? { expected: 0, pending: 0 };
  const netted = netOfReimbursements(gross, input.history);
  const recurring = netted ?? gross;
  const bookedAfter = Math.max(0, input.committed - input.spent);
  const floor = input.committed + Math.max(0, recurring.pending - bookedAfter);

  let expected: number;
  let method: ProjectionMethod;
  if (recurring.expected > 0) {
    // A median well above the known charges is a real level (another bill nobody named); otherwise the charges are the month.
    // A net level already replaced the gross expected, so it is not lifted back up.
    const lifted = !netted && fromHistory != null && n >= 3 && fromHistory > recurring.expected * 1.5;
    expected = lifted && fromHistory != null ? fromHistory : recurring.expected;
    method = "fixed_recurring";
    // Every known charge already posted and the month already looks complete: stop at what is booked.
    if (recurring.pending <= 0 && input.committed >= expected * 0.9) return { total: cents(Math.max(0, input.committed)), method: "fixed_booked", outlierMonths: level?.dropped ? 1 : 0 };
  } else if (fromHistory != null) {
    expected = fromHistory;
    method = "fixed_history";
  } else if (budget > 0) {
    expected = budget;
    method = "fixed_budget";
  } else {
    return { total: cents(Math.max(0, floor)), method: "fixed_booked", outlierMonths: 0 };
  }
  const total = Math.max(0, floor, expected);
  return { total: cents(total), method: floor > expected ? "fixed_booked" : method, outlierMonths: level?.dropped ? 1 : 0 };
}

function projectVariable(input: MonthProjectionInput): MonthProjection {
  const n = input.history.length;
  const budget = Math.max(0, input.budget);
  const spent = input.spent;
  const leftInBudget = Math.max(0, budget - Math.max(0, spent));
  const tail = n ? robustCenter(input.history.map((h) => h.rest), "tail") : null;
  const full = n ? robustCenter(input.history.map((h) => h.total), "level") : null;
  // A series that is one lump after this day, and has already spent a typical month, is done for the month.
  const lumpy = input.history.filter((h) => h.total > 0 && h.rest / h.total >= 0.8).length;
  const landed = n >= 3 && lumpy >= Math.ceil(n * 0.6) && full != null && spent >= full.value * 0.85;

  let remaining: number;
  let method: ProjectionMethod;
  if (landed) {
    remaining = 0;
    method = "variable_history";
  } else if (n >= 2 && tail) {
    remaining = tail.value;
    method = "variable_history";
  } else if (n === 1 && tail) {
    // One month is half the answer; the other half is the budget for the days that are left, capped at what is left of it.
    const prior = Math.min(leftInBudget, budget * (1 - Math.min(1, Math.max(0, input.elapsed ?? 0))));
    remaining = budget > 0 ? (tail.value > budget * 2 ? prior : 0.5 * tail.value + 0.5 * prior) : tail.value;
    method = "variable_history";
  } else if (budget > 0) {
    remaining = leftInBudget;
    method = "variable_budget";
  } else {
    remaining = 0;
    method = "variable_booked";
  }
  const bookedAfter = Math.max(0, input.committed - spent);
  const pending = Math.max(0, (input.recurring?.pending ?? 0) - bookedAfter);
  // Rows already dated after today are part of what still arrives, not a second copy of it.
  const extra = Math.max(pending, remaining - bookedAfter, 0);
  return { total: cents(Math.max(0, input.committed + extra)), method, outlierMonths: tail?.dropped || full?.dropped ? 1 : 0 };
}

/** End-of-month projection of the month in progress. Never negative. */
export function projectMonth(input: MonthProjectionInput): MonthProjection {
  return input.kind === "fixo" ? projectFixed(input) : projectVariable(input);
}

/** A month that has not started. */
export function projectFutureMonth(input: FutureMonthInput): number {
  const kept = input.history.filter((v) => v >= 0);
  const { values } = dropHighOutlier(kept);
  const budget = input.budget != null && input.budget > 0 ? input.budget : 0;
  let base: number;
  if (values.length === 0) base = budget;
  else if (values.length === 1) base = shrinkSingle(values[0] ?? 0, budget);
  else if (values.length === 2) base = Math.min(values[0] ?? 0, values[1] ?? 0);
  else base = median(values);

  const seasonal = (input.seasonal ?? []).filter((v) => v >= 0);
  if (seasonal.length >= 2) {
    const season = median(seasonal);
    const spread = Math.max(...seasonal) / Math.max(1, Math.min(...seasonal));
    // Two years that roughly agree with each other and with the recent level are a season; anything else is a one-off.
    const agrees = spread <= 2 && (base === 0 || (season <= base * 2 && base <= season * 2));
    if (agrees) base = base === 0 ? season : 0.5 * base + 0.5 * season;
  }
  return cents(Math.max(0, base, input.committed));
}

/** The smallest median the trend compares against, so a near-empty window is not a base. */
export const TREND_MIN_BASE = 50;

/** Median of the last three complete months against the three before them; null when not meaningful. */
export function robustTrend(complete: readonly number[]): number | null {
  if (complete.length < 6) return null;
  const recent = complete.slice(-3).map((v) => Math.max(0, v));
  const prior = complete.slice(-6, -3).map((v) => Math.max(0, v));
  if (recent.filter((v) => v > 0).length < 2 || prior.filter((v) => v > 0).length < 2) return null;
  const priorMed = median(prior);
  if (priorMed < TREND_MIN_BASE) return null;
  const ratio = median(recent) / priorMed - 1;
  if (ratio > 2) return null;
  return Math.round(ratio * 10000) / 10000;
}

/** Merchant or description folded so "NETFLIX.COM 11/26" and "Netflix.com" share a key. */
export function merchantKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(\d+\/\d+\)/g, "")
    .replace(/[0-9]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/**
 * Charges that recur: seen in at least three of the six months before
 * `currentMonth`, in at least two of the last three, with an amount that
 * does not swing by more than about a third. `posted` when this month
 * already holds the same key at 60% of its amount or more.
 */
export function detectRecurring(charges: readonly ChargeObservation[], currentMonth: string): RecurringBill[] {
  const now = monthIndex(currentMonth);
  const byKey = new Map<string, Map<string, { amount: number; day: number }>>();
  const thisMonth = new Map<string, number>();
  for (const charge of charges) {
    if (!(charge.amount > 0) || charge.key.length < 3) continue;
    const age = now - monthIndex(charge.month);
    if (age === 0) {
      thisMonth.set(charge.key, (thisMonth.get(charge.key) ?? 0) + charge.amount);
      continue;
    }
    if (age > 6) continue;
    const months = byKey.get(charge.key) ?? new Map<string, { amount: number; day: number }>();
    const prev = months.get(charge.month);
    months.set(charge.month, prev ? { amount: prev.amount + charge.amount, day: charge.amount > prev.amount ? charge.day : prev.day } : { amount: charge.amount, day: charge.day });
    byKey.set(charge.key, months);
  }
  const bills: RecurringBill[] = [];
  for (const [key, months] of byKey) {
    if (months.size < 3) continue;
    const recent = [...months.keys()].filter((m) => now - monthIndex(m) <= 3).length;
    if (recent < 2) continue;
    const amounts = [...months.values()].map((v) => v.amount);
    const amount = median(amounts);
    const deviation = median(amounts.map((a) => Math.abs(a - amount)));
    if (!(amount > 0) || deviation / amount > 0.35) continue;
    const day = Math.round(median([...months.values()].map((v) => v.day)));
    const postedAmount = thisMonth.get(key) ?? 0;
    bills.push({ key, amount, day, seen: months.size, posted: postedAmount >= amount * 0.6, postedAmount });
  }
  return bills;
}

export interface RuleOccurrence {
  /** Rule id; matches the key of the entries the rule booked. */
  key: string;
  /** Base-currency amount of one occurrence. */
  amount: number;
}

/** A positive expense already booked this month, in the category being projected. */
export interface BookedCharge {
  key: string;
  amount: number;
}

/** A recurring expense rule, as the overview and the backtest both see it. */
export interface DueRule {
  key: string;
  /** Base-currency amount of one occurrence. */
  amount: number;
  nextDue: Date;
  frequency: string;
  endDate: Date | null;
  /**
   * An entry with this rule was booked in this month or the two before it.
   * A nextDueDate before the month is not a pending bill without this.
   */
  bookedRecently: boolean;
}

/** Dates of a rule's occurrences from its next due date through the end of the month. */
export function occurrencesIn(next: Date, frequency: string, monthStart: Date, monthEnd: Date, endDate: Date | null): number {
  let count = 0;
  let at = next;
  for (let i = 0; i < 40 && at <= monthEnd && (!endDate || at <= endDate); i++) {
    if (at >= monthStart) count += 1;
    at = frequency === "daily" ? addDays(at, 1) : frequency === "weekly" ? addDays(at, 7) : frequency === "yearly" ? addMonths(at, 12) : addMonths(at, 1);
  }
  return count;
}

/**
 * Rules that are still a bill this month. A nextDueDate before the month
 * means the rule missed its last occurrence: it is not pending, unless it
 * actually booked in this month or the two before it. Stepping a stale date
 * still counts only the occurrences that land in this month.
 */
export function dueRuleOccurrences(rules: readonly DueRule[], monthStart: Date, monthEnd: Date): RuleOccurrence[] {
  return rules.flatMap((rule) => {
    if (rule.nextDue < monthStart && !rule.bookedRecently) return [];
    const count = occurrencesIn(rule.nextDue, rule.frequency, monthStart, monthEnd, rule.endDate);
    if (!count || !(rule.amount > 0)) return [];
    return [{ key: rule.key, amount: cents(rule.amount * count) }];
  });
}

/** About a third: the same band detectRecurring uses for a stable bill. */
const AMOUNT_BAND = 0.35;

function withinBand(charge: number, bill: number): boolean {
  if (!(charge > 0) || !(bill > 0)) return false;
  const gap = Math.abs(charge - bill);
  return gap <= bill * AMOUNT_BAND || gap <= charge * AMOUNT_BAND;
}

/**
 * Known charges for the month: detected bills plus the recurring rules due
 * this month that have not booked an entry yet (a rule with no history is
 * still a bill the user told us about). A booked charge within about ±35%
 * of an open bill, claimed by no other bill, marks that bill posted — the
 * key is not the only way to recognise it. Whatever is still booked and
 * unclaimed then reduces what is left pending, so a bill is not added on
 * top of spend that may already be it.
 */
export function recurringExpectation(bills: readonly RecurringBill[], dueRules: readonly RuleOccurrence[], booked: readonly BookedCharge[] = []): RecurringExpectation {
  let expected = 0;
  const open: { amount: number; claimed: boolean }[] = [];
  for (const bill of bills) {
    expected += bill.amount;
    if (!bill.posted) {
      const left = Math.max(0, bill.amount - bill.postedAmount);
      if (left > 0) open.push({ amount: left, claimed: false });
    }
  }
  const known = new Set(bills.map((b) => b.key));
  const free = booked.filter((c) => c.amount > 0 && !known.has(c.key)).map((c) => ({ amount: c.amount, claimed: false }));
  free.sort((a, b) => b.amount - a.amount);
  const claim = (amount: number) => {
    const idx = free.findIndex((c) => !c.claimed && withinBand(c.amount, amount));
    if (idx < 0) return false;
    free[idx]!.claimed = true;
    return true;
  };
  open.sort((a, b) => b.amount - a.amount);
  for (const item of open) if (claim(item.amount)) item.claimed = true;
  for (const rule of dueRules) {
    if (known.has(rule.key)) continue;
    // A detected bill of about the same amount is this rule, already counted.
    if (bills.some((b) => withinBand(b.amount, rule.amount))) continue;
    expected += rule.amount;
    if (!claim(rule.amount)) open.push({ amount: rule.amount, claimed: false });
  }
  const pending = open.reduce((sum, item) => sum + (item.claimed ? 0 : item.amount), 0);
  const unmatched = free.reduce((sum, c) => sum + (c.claimed ? 0 : c.amount), 0);
  return { expected: cents(expected), pending: cents(Math.max(0, pending - unmatched)) };
}

/**
 * Totals for one calendar month in earlier years, for the row `slot`. A
 * budget for every entity skips entities that have their own budget for
 * the category, the same way spend is assigned.
 */
export function sameMonthHistory(
  rows: readonly { entityId: string; categoryId: string | null; year: number; month: number; total: number }[],
  slot: { entityId: string | null; categoryId: string | null },
  month: number,
  entitiesWithOwnBudget: readonly string[],
): number[] {
  const excluded = new Set(entitiesWithOwnBudget);
  const byYear = new Map<number, number>();
  for (const row of rows) {
    if (row.month !== month || row.categoryId !== slot.categoryId) continue;
    if (slot.entityId ? row.entityId !== slot.entityId : excluded.has(row.entityId)) continue;
    byYear.set(row.year, (byYear.get(row.year) ?? 0) + row.total);
  }
  return [...byYear.values()];
}

/** Months (1-12) that had a budget, as "set–nov" when contiguous; null when none. */
export function budgetedSpan(months: readonly number[]): { from: number; to: number; contiguous: boolean; count: number } | null {
  if (!months.length) return null;
  const sorted = [...months].sort((a, b) => a - b);
  const from = sorted[0] ?? 1;
  const to = sorted[sorted.length - 1] ?? from;
  return { from, to, contiguous: to - from + 1 === sorted.length, count: sorted.length };
}

/* -------------------------------------------------------------------- */
/* The formulas this module replaced, kept only so the backtest can     */
/* score them on the same rows. The overview does not use them.         */
/* -------------------------------------------------------------------- */

function legacyTypical(values: readonly number[]): number {
  if (values.length === 0) return 0;
  if (values.length < 3) return Math.min(...values);
  return median(values);
}

export function legacyStillToCome(totals: readonly number[], tails: readonly number[], spentToDate: number): number {
  if (totals.length === 0) return 0;
  let earlyCeiling = -Infinity;
  for (let i = 0; i < totals.length; i++) earlyCeiling = Math.max(earlyCeiling, (totals[i] ?? 0) - (tails[i] ?? 0));
  const recognized = Math.min(Math.max(0, spentToDate), earlyCeiling);
  return Math.min(legacyTypical(tails), Math.max(0, legacyTypical(totals) - recognized));
}

/** Old end of month: typical tail bounded by the early ceiling; the daily rate without history. */
export function legacyMonthProjection(input: { spent: number; committed: number; daysElapsed: number; daysInMonth: number; totals: readonly number[]; tails: readonly number[] }): number {
  if (input.daysElapsed <= 0) return input.committed;
  const rest = input.totals.length ? legacyStillToCome(input.totals, input.tails, input.spent) : (input.spent / input.daysElapsed) * (input.daysInMonth - input.daysElapsed);
  return cents(input.committed + Math.max(0, rest - Math.max(0, input.committed - input.spent)));
}

/** Old later month: typical of the last six months after the first spend, which can be negative. */
export function legacyFutureMonth(complete: readonly number[], committed: number): number {
  const first = complete.findIndex((v) => v > 0);
  const sample = first === -1 ? [] : complete.slice(first).slice(-6);
  return cents(Math.max(legacyTypical(sample), committed));
}

/** Old trend: mean of the first three complete months against the mean of the last three. */
export function legacyTrend(complete: readonly number[]): number | null {
  if (complete.length < 6) return null;
  const mean = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const first = mean(complete.slice(0, 3));
  if (!(first > 0)) return null;
  return Math.round((mean(complete.slice(-3)) / first - 1) * 10000) / 10000;
}
