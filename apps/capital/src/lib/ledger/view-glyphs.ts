/** Glyph of each view layout, before the view's name in the sidebar and the tabs (mockup LAYOUTS). */
export const LAYOUT_GLYPH: Record<string, string> = { table: "▦", pivot: "⊞", chart: "▮", board: "▥", calendar: "▤" };

export function layoutGlyph(layout: string | undefined): string {
  return (layout && LAYOUT_GLYPH[layout]) || LAYOUT_GLYPH.table;
}
