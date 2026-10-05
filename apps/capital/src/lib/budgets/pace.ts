/**
 * Pace of a budget (mockup BudgetsScreen): the bar shows spent / budget
 * with a mark at today; it only takes a color when something is wrong:
 * red once the budget is passed, yellow when spending runs more than 12
 * points ahead of the month, neutral otherwise.
 */

/** Points (of 100) spending may run ahead of the month before a budget is "Acima do ritmo". */
export const AHEAD_OF_PACE = 0.12;

/** Share of a yearly budget from which its bar turns yellow. */
export const YEARLY_WARN = 0.9;

export type PaceTone = "over" | "ahead" | "normal";

/** The server's status of a monthly budget row. */
export type BudgetStatus = "over" | "ahead_of_pace" | "on_track";

export interface MonthPeriod {
  daysElapsed: number;
  daysInMonth: number;
  isCurrent: boolean;
}

/** Where today's mark goes on the bars (fraction of the month), or null for a closed or future month. */
export function monthPace(period: MonthPeriod): number | null {
  if (!period.isCurrent || period.daysInMonth <= 0) return null;
  return Math.min(1, Math.max(0, period.daysElapsed / period.daysInMonth));
}

/** spent / budget, 0 without a budget. */
export function usage(spent: number, budget: number): number {
  return budget > 0 ? spent / budget : 0;
}

/** Whole percent of a ratio ("73"). */
export const percent = (ratio: number) => Math.round(ratio * 100);

/** Bar and status tone of a monthly budget row, from the server's status. */
export function paceTone(status: BudgetStatus | string): PaceTone {
  return status === "over" ? "over" : status === "ahead_of_pace" ? "ahead" : "normal";
}

/**
 * The same rule the server applies (budget-overview.ts), for a row the
 * client computes itself: passed → over, more than 12 points ahead of
 * the month → ahead.
 */
export function toneOf(ratio: number, pace: number | null): PaceTone {
  if (ratio > 1) return "over";
  if (pace !== null && ratio > pace + AHEAD_OF_PACE) return "ahead";
  return "normal";
}

/** Status label key under budgets.month.status. */
export const STATUS_KEY: Record<PaceTone, "over" | "ahead" | "onTrack"> = { over: "over", ahead: "ahead", normal: "onTrack" };

/** Bar tone of a yearly budget: yellow above 90%. */
export const yearlyTone = (ratio: number): "warn" | "normal" => (ratio > YEARLY_WARN ? "warn" : "normal");

export interface Projection {
  kind: "over" | "slack";
  amount: number;
}

/**
 * A projection against its budget: "R$ X acima" when it passes it, "R$ Y
 * de folga" otherwise. Null without a budget (nothing to compare).
 */
export function projectionVsBudget(projected: number, budget: number): Projection | null {
  if (!(budget > 0)) return null;
  return projected > budget ? { kind: "over", amount: projected - budget } : { kind: "slack", amount: budget - projected };
}
