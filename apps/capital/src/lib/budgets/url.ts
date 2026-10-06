import { compareMonths, monthKey, parseMonthKey, parseYear, sameMonth, type YearMonth } from "./period";

/**
 * URL state of /transactions/budgets: `mode` (month | year), `m`
 * (YYYY-MM, the Mensal view), `y` (YYYY, the Anual view) and `scope`
 * (all | pf | pj | an entity id). Defaults (the current month and year,
 * every entity) are left out of the URL, so a bare link opens today.
 */

export type BudgetsMode = "month" | "year";

/** Entity scope the overview endpoint takes. */
export type BudgetsScope = "all" | "pf" | "pj" | (string & {});

export interface BudgetsUrlParams {
  mode: string | null;
  m: string | null;
  y: string | null;
  scope: string | null;
}

export interface BudgetsView {
  mode: BudgetsMode;
  /** Month of the Mensal view. */
  month: YearMonth;
  /** Year of the Anual view. */
  year: number;
  scope: BudgetsScope;
}

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseScope(value: string | null | undefined): BudgetsScope {
  if (!value || value === "all") return "all";
  return ENTITY_ID.test(value) ? value : "all";
}

/** The screen's state from its URL params; anything missing or malformed falls back to today and every entity. */
export function resolveBudgetsView(params: BudgetsUrlParams, today: YearMonth): BudgetsView {
  const mode: BudgetsMode = params.mode === "year" ? "year" : "month";
  const month = parseMonthKey(params.m) ?? { year: today.year, month: today.month };
  const year = parseYear(params.y) ?? (params.m && parseMonthKey(params.m) ? month.year : today.year);
  return { mode, month, year, scope: parseScope(params.scope) };
}

/** URL params for a view, defaults left out (null removes the param). */
export function budgetsParams(view: BudgetsView, today: YearMonth): BudgetsUrlParams {
  return {
    mode: view.mode === "year" ? "year" : null,
    m: sameMonth(view.month, today) ? null : monthKey(view.month),
    y: view.mode === "year" && view.year !== today.year ? String(view.year) : null,
    scope: view.scope === "all" ? null : view.scope,
  };
}

/**
 * Mensal ⇄ Anual. Going to Anual shows the year of the month on screen;
 * coming back keeps that month when it is in the year shown, else opens
 * today's month (current year), December (a past year) or January (a
 * future one).
 */
export function switchMode(view: BudgetsView, mode: BudgetsMode, today: YearMonth): BudgetsView {
  if (mode === view.mode) return view;
  if (mode === "year") return { ...view, mode, year: view.month.year };
  if (view.month.year === view.year) return { ...view, mode };
  const month = view.year === today.year ? { year: today.year, month: today.month } : { year: view.year, month: view.year < today.year ? 12 : 1 };
  return { ...view, mode, month };
}

/** ‹ and ›: a month in Mensal, a year in Anual. */
export function stepView(view: BudgetsView, delta: number): BudgetsView {
  if (view.mode === "year") return { ...view, year: view.year + delta };
  const index = view.month.year * 12 + view.month.month - 1 + delta;
  return { ...view, month: { year: Math.floor(index / 12), month: (index % 12) + 1 } };
}

/** A heatmap cell opens that month in Mensal. */
export function openMonth(view: BudgetsView, month: number): BudgetsView {
  return { ...view, mode: "month", month: { year: view.year, month } };
}

/** Whether a month is before, during or after today's month. */
export function monthTense(month: YearMonth, today: YearMonth): "past" | "current" | "future" {
  const c = compareMonths(month, today);
  return c < 0 ? "past" : c === 0 ? "current" : "future";
}
