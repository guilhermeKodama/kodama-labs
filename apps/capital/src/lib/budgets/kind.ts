/** A budget's cost kind. Null is stored as null and counts as variável. */
export type BudgetKindName = "fixo" | "variavel";

export function budgetKind(kind: string | null | undefined): BudgetKindName {
  return kind === "fixo" ? "fixo" : "variavel";
}

/**
 * Whether a budget row is shown for the Todos / Fixo / Variável filter.
 * A row that is not a budget (an unbudgeted year cell) only appears on Todos.
 */
export function showsBudgetKind(
  row: { kind: string | null | undefined; isBudgeted?: boolean },
  filter: BudgetKindName | null,
): boolean {
  if (!filter) return true;
  if (row.isBudgeted === false) return false;
  return budgetKind(row.kind) === filter;
}
