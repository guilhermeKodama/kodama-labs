/**
 * Moving the inline editor between table cells (mockup 5188: "Tab próxima
 * célula · ↵ confirma"): after a commit, Tab goes to the next editable
 * cell in reading order (wrapping to the next row), ⇧Tab to the previous
 * one, and ↵ to the same column one row down. Rows are the drawn ones
 * (collapsed groups skipped); read-only cells (a transfer's account,
 * category and entity) are skipped.
 */

export type CellNavDirection = "next" | "previous" | "down";

export interface CellRef {
  rowId: string;
  column: string;
}

/** The cell the editor moves to, or null at the table's edge. */
export function nextEditableCell(
  rowIds: readonly string[],
  columns: readonly string[],
  from: CellRef,
  direction: CellNavDirection,
  editable: (rowId: string, column: string) => boolean
): CellRef | null {
  const row = rowIds.indexOf(from.rowId);
  const col = columns.indexOf(from.column);
  if (row < 0 || col < 0) return null;
  if (direction === "down") {
    for (let r = row + 1; r < rowIds.length; r++) if (editable(rowIds[r], from.column)) return { rowId: rowIds[r], column: from.column };
    return null;
  }
  const step = direction === "next" ? 1 : -1;
  const width = columns.length;
  for (let i = row * width + col + step; i >= 0 && i < rowIds.length * width; i += step) {
    const cell = { rowId: rowIds[Math.floor(i / width)], column: columns[i % width] };
    if (editable(cell.rowId, cell.column)) return cell;
  }
  return null;
}
