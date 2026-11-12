import { textRole } from "./type-scale";

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

/**
 * The Cerne hues the owner approved on the canvas (board CerneCharts),
 * light and dark. Every chart series and every category/entity swatch in
 * src/app/globals.css is one of them (src/lib/__tests__/palette.test.ts).
 */
export const CERNE_HUES = {
  cerne: { light: "#5b2e1f", dark: "#e8dfcf" },
  resina: { light: "#c4862b", dark: "#e0a04a" },
  musgo: { light: "#3d5a36", dark: "#9cc08c" },
  ipe: { light: "#c9a227", dark: "#e9c84a" },
  jacaranda: { light: "#6e4a5e", dark: "#b88fa6" },
  ardosia: { light: "#4f6470", dark: "#8fa7b4" },
  salvia: { light: "#8a9a7b", dark: "#b7c4a8" },
  casca: { light: "#8c7b68", dark: "#b3a592" },
  argila: { light: "#b07a5a", dark: "#d9a07e" },
  alburno: { light: "#d6c9b2", dark: "#5a4a3e" },
  urucum: { light: "#7a3b26", dark: "#d9a487" },
} as const;

/** The Cerne hues, in the order charts hand them out (canvas board CerneCharts). */
export const SERIES_NAMES = ["cerne", "resina", "musgo", "ipe", "jacaranda", "ardosia", "salvia", "casca", "argila", "alburno"] as const;
export type SeriesName = (typeof SERIES_NAMES)[number];

/** Categorical series colors, in assignment order. */
export const CHART_SERIES = SERIES_NAMES.map((_, i) => `var(--cap-chart-${i + 1})`);

/** A series by its hue, for charts that give a meaning a fixed color (a class, an income type). */
export const SERIES = Object.fromEntries(SERIES_NAMES.map((name, i) => [name, CHART_SERIES[i]])) as Record<SeriesName, string>;

/** Axis props shared by every cartesian chart. */
export const CHART_AXIS = { tick: { fontSize: textRole("caption"), fill: CHART.muted }, stroke: CHART.axis } as const;

/**
 * Heatmap cell background: the heat ink at `alpha` (0..1) over the
 * surface. Same pixels as rgba(23,23,23,alpha) in the light theme.
 */
export function heatColor(alpha: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, alpha)) * 100_000) / 1000;
  return `color-mix(in srgb, var(--cap-heat) ${percent}%, transparent)`;
}

export const HEAT_OVER = "var(--cap-heat-over)";

/** The Liberdade financeira trunk (components/invest/fire/trunk.tsx). */
export const TRUNK_COLORS = {
  bg: "var(--cap-trunk-bg)",
  woodA: "var(--cap-trunk-wood-a)",
  woodB: "var(--cap-trunk-wood-b)",
  late: "var(--cap-trunk-late)",
  heart: "var(--cap-trunk-heart)",
  heartInk: "var(--cap-trunk-heart-ink)",
  heartMuted: "var(--cap-trunk-heart-muted)",
  future: "var(--cap-trunk-future)",
  goal: "var(--cap-trunk-goal)",
  ray: "var(--cap-trunk-ray)",
  /** The ring of the year in progress. */
  now: "var(--cap-resin)",
  /** "hoje" and the goal's label. */
  resinInk: "var(--cap-resin-ink)",
  text: "var(--cap-text-1)",
  muted: "var(--cap-text-2)",
} as const;
