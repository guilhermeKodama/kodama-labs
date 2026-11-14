import { budgetKind, type BudgetKindName } from "./kind";
import { filteredYearFigures, type YearFilterRow } from "./slices";
import { monthlyBars } from "./heatmap";

/**
 * Design alternatives of Anual on a wide window, behind the temporary
 * `?dv=` param while the owner picks one. Below md and without the param
 * the screen is unchanged. Nothing here projects: it regroups the months
 * the server already filled in.
 */
export type DesignVariant = "a" | "b" | "c";

export function parseDesignVariant(value: string | null | undefined): DesignVariant | null {
  return value === "a" || value === "b" || value === "c" ? value : null;
}

/** A heatmap section: fixo, variável, or categories that have no budget (shown on Todos only). */
export type SectionKind = BudgetKindName | "none";

export const sectionOf = (row: { kind: string | null | undefined; isBudgeted?: boolean }): SectionKind => (row.isBudgeted === false ? "none" : budgetKind(row.kind));

const SECTION_ORDER: readonly SectionKind[] = ["fixo", "variavel", "none"];

/**
 * The visible rows split into Fixo, Variável and Sem orçamento, each with
 * its month subtotals (the same sums as the Total row), its rows sorted by
 * the year's projection, largest first. Empty sections are left out.
 */
export function heatSections<T extends YearFilterRow & { yearTotal: number }>(rows: readonly T[], nElapsed: number) {
  return SECTION_ORDER.flatMap((kind) => {
    const list = rows.filter((row) => sectionOf(row) === kind).sort((a, b) => b.yearTotal - a.yearTotal);
    if (!list.length) return [];
    const figures = filteredYearFigures(list, null, nElapsed);
    return [{ kind, rows: list, monthTotals: figures.monthTotals, monthProjected: figures.monthProjected, monthBudgets: figures.monthBudgets, summary: figures.summary }];
  });
}

/**
 * Fixo and variável of the year in the scope on screen, whatever the Tipo
 * filter: what each spent so far, its share of the two, and the figures
 * the year KPIs show for it alone.
 */
export function kindSummaries<T extends YearFilterRow>(rows: readonly T[], nElapsed: number) {
  const fixo = filteredYearFigures(rows, "fixo", nElapsed);
  const variavel = filteredYearFigures(rows, "variavel", nElapsed);
  const total = fixo.summary.spentToDate + variavel.summary.spentToDate;
  const share = (spent: number) => (total > 0 ? spent / total : 0);
  return {
    total,
    fixo: { ...fixo, share: share(fixo.summary.spentToDate) },
    variavel: { ...variavel, share: share(variavel.summary.spentToDate) },
  };
}

/**
 * The months of a kind as the phone's mini-bars read them: a lived month
 * is what it spent, a projected one its projection.
 */
export function kindMonths(figures: { monthTotals: readonly number[]; monthProjected: readonly number[]; monthBudgets: readonly number[] }, isProjected: (month: number) => boolean) {
  return figures.monthTotals.map((spent, i) => {
    const projected = isProjected(i + 1);
    const budget = figures.monthBudgets[i] ?? 0;
    return { month: i + 1, spent: projected ? (figures.monthProjected[i] ?? spent) : spent, budget: budget > 0 ? budget : null, isProjected: projected };
  });
}

export interface StackedRow {
  month: number;
  /** Realized and projected spend of each section, in the unit `thousands` returns; 0 when the month has none. */
  real: Record<SectionKind, number>;
  proj: Record<SectionKind, number>;
}

/**
 * "Gasto mensal vs orçado" stacked by section: each month's bar is the
 * same total as the single-series chart, split into fixo, variável and
 * sem orçamento, realized then projected.
 */
export function stackedMonthlyBars(
  sections: readonly { kind: SectionKind; monthTotals: readonly number[]; monthProjected: readonly number[] }[],
  isProjected: (month: number) => boolean,
  thousands: (v: number) => number,
): StackedRow[] {
  const empty = (): Record<SectionKind, number> => ({ fixo: 0, variavel: 0, none: 0 });
  const rows: StackedRow[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, real: empty(), proj: empty() }));
  for (const section of sections) {
    monthlyBars(section.monthTotals, isProjected, thousands, section.monthProjected).forEach((bar, i) => {
      rows[i].real[section.kind] = bar.real;
      rows[i].proj[section.kind] = bar.proj;
    });
  }
  return rows;
}
