import type { LedgerDisplayRow, LedgerGroup } from "@capital/server/modules/ledger/contracts";

/**
 * Board columns (mockup boardLayout 2960–2992). The server sends the rows
 * grouped by the board's key, in column order, each with its column in
 * `groupKeys[0]` (every bucket and the "from→to" key of a neutral transfer
 * included), so a card always lands in the column the server counted it
 * in. A column can load the rest of its rows on its own ("Carregar mais").
 */

type BoardRow = Pick<LedgerDisplayRow, "id" | "groupKeys">;

/** The column of a row (null = the empty value, e.g. Sem categoria). */
export function boardColumnOf(row: BoardRow): string | null {
  return row.groupKeys?.[0] ?? null;
}

/**
 * The cards of one column: the column's own pages when it loaded them,
 * then any row of the view's first pages it does not have yet (both in
 * the view's sort, so the column's pages start with those rows).
 */
export function boardCards<R extends BoardRow>(key: string | null, viewRows: readonly R[], columnRows?: readonly R[]): R[] {
  const out: R[] = [];
  const seen = new Set<string>();
  for (const row of [...(columnRows ?? []), ...viewRows]) {
    if (boardColumnOf(row) !== key || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Rows of the column not loaded yet (the column header counts them all). */
export function boardRemaining(group: Pick<LedgerGroup, "count">, shown: number): number {
  return Math.max(0, group.count - shown);
}

/** Page size of a column's "Carregar mais": what it shows plus a step, so the first page already adds cards. */
export const BOARD_COLUMN_STEP = 100;
export function boardColumnLimit(shown: number): number {
  return Math.min(500, shown + BOARD_COLUMN_STEP);
}
