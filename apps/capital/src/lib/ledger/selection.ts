/**
 * Row selection in the table (mockup toggleSel 2145–2155): a click toggles
 * one row; a shift-click toggles the range from the last clicked row, in
 * the order rows are drawn (grouped order when grouped, collapsed groups
 * included as drawn). Stats are the bulk bar's Σ / média / mín / máx.
 */

export interface SelectionClick {
  id: string;
  on: boolean;
  shift: boolean;
}

/** The selection after a click; `visual` is the row ids in drawn order. */
export function applySelectionClick(selected: ReadonlySet<string>, visual: readonly string[], last: string | null, click: SelectionClick): Set<string> {
  const next = new Set(selected);
  const a = last === null ? -1 : visual.indexOf(last);
  const b = visual.indexOf(click.id);
  const ids = click.shift && a >= 0 && b >= 0 ? visual.slice(Math.min(a, b), Math.max(a, b) + 1) : [click.id];
  for (const id of ids) {
    if (click.on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Whether every visible row is selected (the header checkbox and the select-all banner). */
export function allVisibleSelected(selected: ReadonlySet<string>, visible: readonly string[]): boolean {
  return visible.length > 0 && visible.every((id) => selected.has(id));
}

export interface SelectionStats {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/** Σ, média, mín and máx over the counted rows of a selection (a neutral transfer moves no money). */
export function selectionStats(rows: readonly { counts: boolean; displayAmount: number }[]): SelectionStats {
  const values = rows.filter((row) => row.counts).map((row) => row.displayAmount);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    count: rows.length,
    sum,
    avg: values.length ? sum / values.length : 0,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

/** Moves the keyboard focus one row up or down in drawn order (clamped); the first row when nothing is focused. */
export function moveFocus(visual: readonly string[], focused: string | null, delta: 1 | -1): string | null {
  if (!visual.length) return null;
  const index = focused === null ? -1 : visual.indexOf(focused);
  if (index < 0) return visual[delta > 0 ? 0 : visual.length - 1];
  return visual[Math.min(visual.length - 1, Math.max(0, index + delta))];
}
