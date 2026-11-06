import { budgetKind, showsBudgetKind, type BudgetKindName } from "./kind";

/** A budget row the month totals and the pace chart can see. */
export interface SliceRow {
  kind: string | null | undefined;
  isBudgeted?: boolean;
  amount: number;
  spent: number;
  net?: number;
  remaining: number;
  reimbursed?: number;
  available: number;
  pace: { projectedTotal: number };
}

/** Orçado (the amount), líquido, restante and the projection of one slice. */
export interface KindSlice {
  budget: number;
  net: number;
  remaining: number;
  reimbursed: number;
  available: number;
  projected: number;
}

const sliceOf = (list: readonly SliceRow[]): KindSlice => ({
  budget: list.reduce((sum, row) => sum + row.amount, 0),
  net: list.reduce((sum, row) => sum + (row.net ?? row.spent), 0),
  remaining: list.reduce((sum, row) => sum + row.remaining, 0),
  reimbursed: list.reduce((sum, row) => sum + (row.reimbursed ?? 0), 0),
  available: list.reduce((sum, row) => sum + row.available, 0),
  projected: list.reduce((sum, row) => sum + row.pace.projectedTotal, 0),
});

/**
 * Fixo, variável and total for the rows that survive the active kind filter.
 * Scope and month are already applied to `rows`. Null kind counts as variável.
 */
export function filteredKindTotals<T extends SliceRow>(rows: readonly T[], filter: BudgetKindName | null) {
  const visible = rows.filter((row) => showsBudgetKind(row, filter));
  const ofKind = (kind: BudgetKindName) => visible.filter((row) => budgetKind(row.kind) === kind);
  return {
    rows: visible,
    fixo: sliceOf(ofKind("fixo")),
    variavel: sliceOf(ofKind("variavel")),
    total: sliceOf(visible),
  };
}

export interface PacePoint {
  day: number;
  cumulative: number;
  ideal: number;
  fixo?: number;
  variavel?: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The pace chart for the active kind filter. The stacked areas are the
 * cumulative líquido of each kind; the cumulative line is their sum, and
 * the ideal line is the filtered budgets' available spread over the month.
 */
export function paceForKind<T extends { kind: string | null | undefined; isBudgeted?: boolean; available: number }>(
  series: readonly PacePoint[],
  rows: readonly T[],
  filter: BudgetKindName | null,
  daysInMonth: number,
) {
  const available = rows.filter((row) => showsBudgetKind(row, filter)).reduce((sum, row) => sum + row.available, 0);
  return series.map((point) => {
    const split = point.fixo != null || point.variavel != null;
    const fixo = split ? (filter === "variavel" ? 0 : point.fixo ?? 0) : 0;
    const variavel = split ? (filter === "fixo" ? 0 : point.variavel ?? 0) : filter === "fixo" ? 0 : point.cumulative;
    return {
      day: point.day,
      fixo: cents(fixo),
      variavel: cents(variavel),
      cumulative: split || filter === "fixo" ? cents(fixo + variavel) : point.cumulative,
      ideal: daysInMonth > 0 ? cents((available * point.day) / daysInMonth) : 0,
    };
  });
}
