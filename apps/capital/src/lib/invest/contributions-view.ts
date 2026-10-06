/**
 * Investimentos › Aportes: the trailing-months chart, the monthly history
 * with its status against the goal, and the window navigation.
 */
import type { AllocationClass, ContributionMonth, ContributionOrigin } from "./types";
import { ALLOCATION_CLASSES } from "./types";

/** "YYYY-MM" → { year, month }. */
export function parseMonth(period: string): { year: number; month: number } {
  return { year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) };
}

/** Adds months to "YYYY-MM". */
export function shiftMonth(period: string, delta: number): string {
  const { year, month } = parseMonth(period);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" of a date string or of today in a timezone. */
export function currentMonth(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** A valid "YYYY-MM" no later than `max`, or `max`. */
export function clampEnd(value: string | null | undefined, max: string): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return max;
  return value > max ? max : value;
}

export interface StackedMonth {
  period: string;
  /** Total aportado (net) in the month. */
  net: number;
  values: Partial<Record<AllocationClass, number>>;
}

/** Series of the "Aportes por mês e classe" chart: classes with money in the window, in display order. */
export function contributionSeries(months: readonly ContributionMonth[]): { classes: AllocationClass[]; rows: StackedMonth[] } {
  const classes = ALLOCATION_CLASSES.filter((cls) => months.some((m) => (m.byAllocationClass[cls] ?? 0) > 0.005));
  const rows = months.map((m) => ({
    period: m.period,
    net: m.net,
    values: Object.fromEntries(classes.map((cls) => [cls, Math.max(0, m.byAllocationClass[cls] ?? 0)])) as Partial<Record<AllocationClass, number>>,
  }));
  return { classes, rows };
}

export type GoalStatus = "ok" | "above" | "below";

/** Within 2% of the goal counts as "na meta". */
export const GOAL_TOLERANCE = 0.02;

export function goalStatus(net: number, goal: number | null): GoalStatus | null {
  if (goal === null || !(goal > 0)) return null;
  const slack = Math.max(1, goal * GOAL_TOLERANCE);
  if (net > goal + slack) return "above";
  if (net < goal - slack) return "below";
  return "ok";
}

/** Where the money of the month came from: the transfers' descriptions, or "origem → corretora". */
export function originLabel(origins: readonly ContributionOrigin[]): string {
  const inflows = origins.filter((o) => o.amount > 0).sort((a, b) => b.amount - a.amount);
  const list = (inflows.length ? inflows : origins).map(
    (o) => o.description?.trim() || `${o.sourceEntityName ?? o.counterpartEntityName ?? o.counterpartAccountName ?? "?"} → ${o.brokerEntityName}`,
  );
  return [...new Set(list)].join(" + ");
}

export interface HistoryRow {
  period: string;
  net: number;
  origin: string;
  status: GoalStatus | null;
  /** The month's transfers (aportes and, across entities, the transfer that fed them), for the Transações drill. */
  transferGroupIds: string[];
}

/** One row per month with money moved, newest first (mockup "Histórico de aportes"). */
export function historyRows(months: readonly ContributionMonth[], goal: number | null): HistoryRow[] {
  return months
    .filter((m) => m.origins.length > 0)
    .map((m) => ({
      period: m.period,
      net: m.net,
      origin: originLabel(m.origins),
      status: goalStatus(m.net, goal),
      transferGroupIds: [...new Set(m.origins.flatMap((o) => (o.sourceTransferGroupId ? [o.transferGroupId, o.sourceTransferGroupId] : [o.transferGroupId])))],
    }))
    .reverse();
}

/** The "Com R$ X/mês" alternative of the FIRE block: 20% more, rounded up to a thousand (mockup 15.000 → 18.000). */
export function alternativeContribution(current: number | null): number | null {
  if (current === null || !(current > 0)) return null;
  return Math.ceil((current * 1.2) / 1000) * 1000;
}

/** Compact money: { value: "4,2", unit: "mi" | "mil" | null } per the number format (mockup "R$ 4,2 mi"). */
export function compactAmount(value: number, format: (n: number, digits: { min: number; max: number }) => string): { value: string; unit: "bi" | "mi" | "mil" | null } {
  const abs = Math.abs(value);
  if (abs >= 1e9) return { value: format(value / 1e9, { min: 0, max: 1 }), unit: "bi" };
  if (abs >= 1e6) return { value: format(value / 1e6, { min: 0, max: 1 }), unit: "mi" };
  if (abs >= 1e4) return { value: format(value / 1e3, { min: 0, max: 0 }), unit: "mil" };
  return { value: format(value, { min: 0, max: 0 }), unit: null };
}
