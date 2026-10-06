/**
 * The Anual heatmap (mockup AnnualBudget): category × month in % of the
 * budget. The closer to the limit the stronger the cell, red once passed;
 * projected months are dashed and never colored.
 */

export type HeatLevel = "over" | "high" | "mid" | "low" | "projected" | "empty";

export interface HeatCell {
  spent: number;
  budget: number | null;
  isProjected: boolean;
}

/** Cell shade: > 100% over, ≥ 90% high, ≥ 70% mid, else low; dashed when projected; empty without a budget that month. */
export function heatLevel(cell: HeatCell): HeatLevel {
  if (cell.isProjected) return "projected";
  if (!cell.budget || cell.budget <= 0) return "empty";
  const r = cell.spent / cell.budget;
  return r > 1 ? "over" : r >= 0.9 ? "high" : r >= 0.7 ? "mid" : "low";
}

/** Whole percent of the budget a cell spent, null without a budget. */
export function heatPercent(cell: Pick<HeatCell, "spent" | "budget">): number | null {
  return cell.budget && cell.budget > 0 ? Math.round((cell.spent / cell.budget) * 100) : null;
}

/** A cell opens its month (Mensal) unless it is projected. */
export const isClickable = (cell: HeatCell) => !cell.isProjected;

/**
 * Month column of the header: months before the current one are actual,
 * the current one is marked "*", later ones are projections.
 * `currentMonth` is 1-12 in the current year, 12 for a past year and 0
 * for a future one (yearOverview.currentMonth).
 */
export function columnTense(month: number, currentMonth: number, isPastYear: boolean): "actual" | "current" | "projected" {
  if (isPastYear) return "actual";
  if (month < currentMonth) return "actual";
  return month === currentMonth ? "current" : "projected";
}

/** Total row cell: red when an actual month passed that month's budget. */
export function totalTone(total: number, budget: number, isProjected: boolean): "projected" | "over" | "normal" {
  if (isProjected) return "projected";
  return budget > 0 && total > budget ? "over" : "normal";
}

export type TrendKind = "up" | "down" | "stable" | "none";

/** Tendência: ↑ above +10%, ↓ below −10%, → estável between; none when there is too little history. */
export function trendOf(trend: number | null | undefined): { kind: TrendKind; pct: number } {
  if (trend === null || trend === undefined || !Number.isFinite(trend)) return { kind: "none", pct: 0 };
  if (trend > 0.1) return { kind: "up", pct: Math.round(trend * 100) };
  if (trend < -0.1) return { kind: "down", pct: Math.round(-trend * 100) };
  return { kind: "stable", pct: 0 };
}

/**
 * The chart's "Orçado/mês" line: one reference value when every month
 * with a budget has the same total (the usual case), else null and the
 * chart draws the budget month by month.
 */
export function flatMonthlyBudget(monthBudgets: readonly number[]): number | null {
  const values = monthBudgets.filter((v) => v > 0);
  if (!values.length) return null;
  return values.every((v) => Math.abs(v - values[0]) < 0.005) ? values[0] : null;
}

/**
 * Bars of "Gasto mensal vs orçado": realized months in one series,
 * projected ones in the other (stacked, so each month has one bar), in
 * thousands rounded to one decimal.
 */
export function monthlyBars(monthTotals: readonly number[], isProjected: (month: number) => boolean, thousands: (v: number) => number) {
  return monthTotals.map((total, i) => {
    const projected = isProjected(i + 1);
    return { month: i + 1, real: projected ? 0 : thousands(total), proj: projected ? thousands(total) : 0 };
  });
}
