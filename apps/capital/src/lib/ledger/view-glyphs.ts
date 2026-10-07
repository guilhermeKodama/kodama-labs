import { CalendarDays, ChartColumnBig, Grid3x3, SquareKanban, Table2, type LucideIcon } from "lucide-react";

/** Glyph of each view layout, as text: the ⌘K results (mockup LAYOUTS). */
export const LAYOUT_GLYPH: Record<string, string> = { table: "▦", pivot: "⊞", chart: "▮", board: "▥", calendar: "▤" };

export function layoutGlyph(layout: string | undefined): string {
  return (layout && LAYOUT_GLYPH[layout]) || LAYOUT_GLYPH.table;
}

/** Icon of each view layout (Notion-like): the Exibição layout picker, the tabs, the sidebar and the Carteira tabs. */
export const LAYOUT_ICON: Record<string, LucideIcon> = { table: Table2, pivot: Grid3x3, chart: ChartColumnBig, board: SquareKanban, calendar: CalendarDays };
