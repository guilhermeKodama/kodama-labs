/**
 * Chart colors as CSS variable references (defined in src/app/globals.css
 * for light and dark). Recharts and plain SVG take them as fill/stroke
 * values, so charts follow the theme without reading it in JS.
 */
export const CHART = {
  grid: "var(--cap-chart-grid)",
  axis: "var(--cap-chart-axis)",
  muted: "var(--cap-chart-muted)",
  ink: "var(--cap-chart-ink)",
  bar: "var(--cap-chart-bar)",
  label: "var(--cap-chart-label)",
  soft: "var(--cap-chart-soft)",
  area: "var(--cap-chart-area)",
  accent: "var(--cap-chart-accent)",
  accentSoft: "var(--cap-chart-accent-soft)",
  warn: "var(--cap-chart-warn)",
} as const;

/** Categorical series colors, in assignment order. */
export const CHART_SERIES = Array.from({ length: 10 }, (_, i) => `var(--cap-chart-${i + 1})`);

/** Axis props shared by every cartesian chart. */
export const CHART_AXIS = { tick: { fontSize: 11, fill: CHART.muted }, stroke: CHART.axis } as const;

/**
 * Heatmap cell background: the heat ink at `alpha` (0..1) over the
 * surface. Same pixels as rgba(23,23,23,alpha) in the light theme.
 */
export function heatColor(alpha: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, alpha)) * 100_000) / 1000;
  return `color-mix(in srgb, var(--cap-heat) ${percent}%, transparent)`;
}

export const HEAT_OVER = "var(--cap-heat-over)";
