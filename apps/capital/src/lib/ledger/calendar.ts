import type { LedgerDisplayRow, LedgerGroup } from "@capital/server/modules/ledger/contracts";
import { COUNT_KEY, SUM_KEY } from "./columns";

/**
 * Calendar layout (mockup calendarLayout 2994–3055): the last month of the
 * period, Monday first; each day with its net Σ over counted rows, two
 * descriptions and "+N"; three background tiers by |Σ|; a caption with
 * the rows of the period that fall in other months.
 */

/** Days of the month and blank cells before day 1 (Monday first), padded to whole weeks. */
export function monthGrid(month: string): { days: number; lead: number; cells: number } {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  return { days, lead, cells: Math.ceil((lead + days) / 7) * 7 };
}

/** "YYYY-MM-DD" of a day of the month. */
export function dayIso(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Background tier of a day by |Σ| (mockup: > 3000 strongest, > 500, > 0, none). */
export function dayShade(total: number): 0 | 2 | 3 | 4 {
  const mag = Math.abs(total);
  return mag > 3000 ? 2 : mag > 500 ? 3 : mag > 0 ? 4 : 0;
}

export interface CalendarDay {
  total: number;
  count: number;
}

/** Σ and count per day of the month, from the day groups of the whole period. */
export function calendarDays(groups: readonly LedgerGroup[], month: string): Map<string, CalendarDay> {
  const out = new Map<string, CalendarDay>();
  for (const g of groups) {
    if (!g.key?.startsWith(`${month}-`)) continue;
    out.set(g.key, { total: g.values[SUM_KEY] ?? 0, count: g.values[COUNT_KEY] ?? g.count });
  }
  return out;
}

/** Rows of the period outside the month on screen (the caption's "N de outros meses"). */
export function outsideCount(days: ReadonlyMap<string, CalendarDay>, periodCount: number): number {
  let inMonth = 0;
  for (const day of days.values()) inMonth += day.count;
  return Math.max(0, periodCount - inMonth);
}

/** The rows of each day (on the view's date field), in the order they came. */
export function rowsByDay<R extends Pick<LedgerDisplayRow, "date" | "effectiveDate">>(rows: readonly R[], dateField: "date" | "effectiveDate"): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const row of rows) {
    const day = row[dateField];
    const list = out.get(day);
    if (list) list.push(row);
    else out.set(day, [row]);
  }
  return out;
}
