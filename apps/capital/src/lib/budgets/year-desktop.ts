import { budgetKind, type BudgetKindName } from "./kind";
import { filteredYearFigures, type YearFilterRow } from "./slices";

/**
 * Anual on a wide window: the rows grouped by kind, and the fixo/variável
 * totals of the year. Nothing here projects: it regroups the months the
 * server already filled in. Below md the phone cards take over.
 */

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
