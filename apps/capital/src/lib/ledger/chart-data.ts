import type { LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { COUNT_KEY, CUMULATIVE_TYPES, SUM_KEY, type ChartType } from "./columns";

/**
 * Chart data from the query's groups (mockup chartLayout 2863–2921). The
 * groups are over counted display rows (rowsScope "counted"), axis first
 * and series as children, in the server's order (time ascending, others
 * by |Σ| descending).
 *
 * - Valor: "sum" is |Σ| per group, "count" the rows, "avg" |Σ| ÷ rows.
 * - Limitar (Top N + Outros) ranks the axis by that value and folds the
 *   rest into one "Outros" category, adding sums and counts (so its
 *   average stays right); not for line and area.
 * - Séries pivot the children, zero-filled; series are ordered by their
 *   total weight (time keys ascending).
 * - Acumulado is a running sum per series, only for bar, line and area.
 * - 100% turns each category's series into shares.
 * - Waterfall uses the signed Σ (zero groups dropped).
 */

export type ChartMetric = ViewConfig["chart"]["metric"];

export interface ChartCategory {
  /** The axis group key; null = empty (Sem categoria). Outros has `others`. */
  key: string | null;
  /** Keys folded into "Outros". */
  others?: (string | null)[];
}

export interface ChartSeries {
  /** Series group key; null for the single series of a chart without Séries, or the empty value. */
  key: string | null;
  values: number[];
}

export interface ChartData {
  categories: ChartCategory[];
  series: ChartSeries[];
  hasSeries: boolean;
  /** Signed Σ per category (waterfall). */
  signed: number[];
  /** The value per category with all series together (pie, donut, treemap). */
  totals: number[];
}

interface Acc {
  sum: number;
  count: number;
}

const accOf = (g: Pick<LedgerGroup, "count" | "values">): Acc => ({ sum: g.values[SUM_KEY] ?? 0, count: g.values[COUNT_KEY] ?? g.count });

/** The metric of an accumulated group (mockup metricOf). */
export function metricValue(acc: Acc, metric: ChartMetric): number {
  if (metric === "count") return acc.count;
  const abs = Math.abs(acc.sum);
  return metric === "avg" ? (acc.count ? abs / acc.count : 0) : abs;
}

const add = (a: Acc, b: Acc): Acc => ({ sum: a.sum + b.sum, count: a.count + b.count });

export interface ChartDataOptions {
  type: ChartType;
  metric: ChartMetric;
  cumulative: boolean;
  top: number;
  /** Whether the query grouped by a series key (children carry the series). */
  hasSeries: boolean;
  /** The series key is a time bucket (order its values ascending). */
  timeSeries?: boolean;
}

/** Whether Top N applies to this chart (mockup: not line/area, and more groups than N). */
export function appliesTop(type: ChartType, top: number, groups: number): boolean {
  return top > 0 && type !== "line" && type !== "area" && groups > top;
}

export function buildChartData(groups: readonly LedgerGroup[], options: ChartDataOptions): ChartData {
  const { type, metric, top } = options;
  const rounded = (v: number) => (metric === "count" ? v : Math.round(v));

  // Axis categories, each with its total and its per-series accumulators.
  type Cat = { key: string | null; others?: (string | null)[]; acc: Acc; bySeries: Map<string | null, Acc> };
  let cats: Cat[] = groups.map((g) => ({
    key: g.key,
    acc: accOf(g),
    bySeries: new Map((g.children ?? []).map((c) => [c.key, accOf(c)])),
  }));

  if (appliesTop(type, top, cats.length)) {
    const ranked = [...cats].sort((a, b) => metricValue(b.acc, metric) - metricValue(a.acc, metric));
    const kept = ranked.slice(0, top);
    const rest = ranked.slice(top);
    const bySeries = new Map<string | null, Acc>();
    for (const c of rest) for (const [k, v] of c.bySeries) bySeries.set(k, add(bySeries.get(k) ?? { sum: 0, count: 0 }, v));
    cats = [...kept, { key: null, others: rest.map((c) => c.key), acc: rest.reduce((s, c) => add(s, c.acc), { sum: 0, count: 0 }), bySeries }];
  }

  const hasSeries = options.hasSeries && cats.some((c) => c.bySeries.size > 0);
  let seriesKeys: (string | null)[] = [];
  if (hasSeries) {
    const weight = new Map<string | null, number>();
    for (const c of cats) for (const [k, v] of c.bySeries) weight.set(k, (weight.get(k) ?? 0) + v.sum);
    seriesKeys = [...weight.keys()];
    seriesKeys.sort((a, b) => {
      if (options.timeSeries) return a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
      return Math.abs(weight.get(b) ?? 0) - Math.abs(weight.get(a) ?? 0) || String(a).localeCompare(String(b));
    });
  }

  const cumulative = options.cumulative && CUMULATIVE_TYPES.includes(type);
  const running = (values: number[]) => {
    if (!cumulative) return values;
    let acc = 0;
    return values.map((v) => (acc += v));
  };

  let series: ChartSeries[] = hasSeries
    ? seriesKeys.map((key) => ({ key, values: running(cats.map((c) => rounded(metricValue(c.bySeries.get(key) ?? { sum: 0, count: 0 }, metric)))) }))
    : [{ key: null, values: running(cats.map((c) => rounded(metricValue(c.acc, metric)))) }];

  if (type === "bar100" && hasSeries) {
    series = series.map((s) => ({
      ...s,
      values: s.values.map((v, i) => {
        const total = series.reduce((sum, other) => sum + other.values[i], 0);
        return total ? v / total : 0;
      }),
    }));
  }

  return {
    categories: cats.map(({ key, others }) => (others ? { key, others } : { key })),
    series,
    hasSeries,
    signed: cats.map((c) => c.acc.sum),
    totals: cats.map((c) => metricValue(c.acc, metric)),
  };
}

/** Rows of the waterfall: signed Σ per category, zero groups dropped. */
export function waterfallItems(data: ChartData): { category: ChartCategory; value: number }[] {
  return data.categories.map((category, i) => ({ category, value: data.signed[i] })).filter((item) => item.value !== 0);
}

/** Slices of pie and donut: positive values only (rounded, as drawn). */
export function pieItems(data: ChartData, metric: ChartMetric): { category: ChartCategory; value: number }[] {
  return data.categories
    .map((category, i) => ({ category, value: metric === "count" ? data.totals[i] : Math.round(data.totals[i]) }))
    .filter((item) => item.value > 0);
}
