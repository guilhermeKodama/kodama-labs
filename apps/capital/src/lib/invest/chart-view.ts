/**
 * Chart layout of the Carteira views: adapts the holdings table and the
 * filtered operations into the ledger's chart input (LedgerGroup[]), so the
 * ledger's data builder (Top N + Outros, cumulative, series) and renderers
 * are reused as they are. Pure.
 */
import type { LedgerGroup } from "@capital/server/modules/ledger/contracts";
import { COUNT_KEY, SUM_KEY, type ChartType } from "@/lib/ledger/columns";
import type { HoldingRow, HoldingsTable } from "./holdings-view";
import {
  monthsBetween,
  opBaseValue,
  opsPeriodRange,
  type OpsViewConfig,
} from "./ops-view";
import type { AllocationClass, Operation } from "./types";

export const HOLDINGS_CHART_TYPES: readonly ChartType[] = [
  "bar",
  "hbar",
  "pie",
  "donut",
  "treemap",
];
export const OPS_CHART_TYPES: readonly ChartType[] = [
  "bar",
  "line",
  "area",
  "pie",
  "donut",
];
export const HOLDINGS_METRICS = ["marketValue", "share", "result"] as const;
export type HoldingsMetric = (typeof HOLDINGS_METRICS)[number];
export const OPS_METRICS = ["sum", "count", "avg"] as const;
export type OpsMetric = (typeof OPS_METRICS)[number];
export const OPS_CHART_AXES = ["month", "type", "allocationClass"] as const;
export type OpsChartAxis = (typeof OPS_CHART_AXES)[number];

export interface InvestChart<M extends string> {
  type: ChartType;
  metric: M;
  cumulative: boolean;
  top: number;
}

const topOf = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 50 ? v : 0;
const obj = (raw: unknown) =>
  raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

/** A stored holdings chart with every field valid ("sum"/"avg"/"count" of older configs read as the market value). */
export function normalizeHoldingsChart(
  raw: unknown,
): InvestChart<HoldingsMetric> {
  const c = obj(raw);
  return {
    type: HOLDINGS_CHART_TYPES.includes(c.type as ChartType)
      ? (c.type as ChartType)
      : "bar",
    metric: (HOLDINGS_METRICS as readonly unknown[]).includes(c.metric)
      ? (c.metric as HoldingsMetric)
      : "marketValue",
    cumulative: false,
    top: topOf(c.top),
  };
}

/** A stored operations chart with every field valid. */
export function normalizeOpsChart(raw: unknown): InvestChart<OpsMetric> {
  const c = obj(raw);
  return {
    type: OPS_CHART_TYPES.includes(c.type as ChartType)
      ? (c.type as ChartType)
      : "bar",
    metric: (OPS_METRICS as readonly unknown[]).includes(c.metric)
      ? (c.metric as OpsMetric)
      : "sum",
    cumulative: c.cumulative === true,
    top: topOf(c.top),
  };
}

/** The axis of an operations chart: the view's grouping, or the month (also for "none"). */
export function opsChartAxis(groupBy: OpsViewConfig["groupBy"]): OpsChartAxis {
  return groupBy === "type" || groupBy === "allocationClass"
    ? groupBy
    : "month";
}

export interface HoldingsChartGroups {
  groups: LedgerGroup[];
  /** How buildChartData must read them: "sum" (money) or "count" (fractions and signed money, never rounded or |abs|). */
  buildMetric: "sum" | "count";
  /** How a value prints. */
  unit: "money" | "pct";
  /** Rows by category key, when the chart is per asset (groupBy none). */
  rows: Map<string, HoldingRow>;
}

/**
 * Holdings table → chart groups. Grouped views chart their groups; an
 * ungrouped one charts each asset (ticker; the brokers' cash is one "CAIXA"
 * category). Metrics: market value, share of the portfolio, and the
 * unrealized result in money (value − invested; signed).
 */
export function holdingsChartGroups(
  table: HoldingsTable,
  groupBy: string,
  metric: HoldingsMetric,
): HoldingsChartGroups {
  const perAsset = groupBy === "none";
  const rows = new Map<string, HoldingRow>();
  const cats: {
    key: string;
    value: number;
    invested: number;
    share: number;
  }[] = perAsset
    ? table.groups.flatMap((g) =>
        g.rows.map((r) => {
          rows.set(r.key, r);
          return {
            key: r.key,
            value: r.value,
            invested: r.invested,
            share: r.share,
          };
        }),
      )
    : table.groups.map((g) => ({
        key: g.key,
        value: g.value,
        invested: g.rows.reduce((s, r) => s + r.invested, 0),
        share: g.share,
      }));
  const groups: LedgerGroup[] = cats.map((c) => {
    const amount =
      metric === "marketValue"
        ? c.value
        : metric === "share"
          ? c.share
          : c.value - c.invested;
    return metric === "marketValue"
      ? { key: c.key, count: 1, values: { [SUM_KEY]: amount, [COUNT_KEY]: 1 } }
      : {
          key: c.key,
          count: 1,
          values: { [SUM_KEY]: amount, [COUNT_KEY]: amount },
        };
  });
  return {
    groups,
    buildMetric: metric === "marketValue" ? "sum" : "count",
    unit: metric === "share" ? "pct" : "money",
    rows,
  };
}

const CLASS_ORDER: readonly AllocationClass[] = [
  "fixed_income",
  "br_stocks",
  "fii",
  "international",
  "crypto",
  "cash",
];

/**
 * Operations → chart groups on the view's axis (month zero-filled and
 * ascending; type and class by |Σ| descending), with the class as the
 * series when the view says so. Values are in the base currency (income net
 * of tax).
 */
export function opsChartGroups(
  ops: readonly Operation[],
  config: OpsViewConfig,
  today: string,
  rateFor: (currency: string | null) => number,
): LedgerGroup[] {
  const axis = opsChartAxis(config.groupBy);
  const bySeries =
    config.series === "allocationClass" && axis !== "allocationClass";
  const classOf = (op: Operation): string => op.allocationClass ?? "cash";
  const keyOf = (op: Operation): string =>
    axis === "month"
      ? op.date.slice(0, 7)
      : axis === "type"
        ? op.type
        : classOf(op);

  const acc = new Map<
    string,
    {
      sum: number;
      count: number;
      series: Map<string, { sum: number; count: number }>;
    }
  >();
  if (axis === "month") {
    const range =
      opsPeriodRange(config.period, today) ??
      opsPeriodRange({ preset: "last_12m" }, today)!;
    for (const m of monthsBetween(range.from, range.to))
      acc.set(m, { sum: 0, count: 0, series: new Map() });
  }
  for (const op of ops) {
    const key = keyOf(op);
    if (axis === "month" && !acc.has(key)) continue;
    const a = acc.get(key) ?? { sum: 0, count: 0, series: new Map() };
    const value = opBaseValue(op, rateFor);
    a.sum += value;
    a.count += 1;
    if (bySeries) {
      const s = a.series.get(classOf(op)) ?? { sum: 0, count: 0 };
      s.sum += value;
      s.count += 1;
      a.series.set(classOf(op), s);
    }
    acc.set(key, a);
  }
  const groups: LedgerGroup[] = [...acc.entries()].map(([key, a]) => ({
    key,
    count: a.count,
    values: { [SUM_KEY]: a.sum, [COUNT_KEY]: a.count },
    ...(bySeries && {
      children: [...a.series.entries()]
        .sort(
          (x, y) =>
            CLASS_ORDER.indexOf(x[0] as AllocationClass) -
            CLASS_ORDER.indexOf(y[0] as AllocationClass),
        )
        .map(([k, s]) => ({
          key: k,
          count: s.count,
          values: { [SUM_KEY]: s.sum, [COUNT_KEY]: s.count },
        })),
    }),
  }));
  if (axis !== "month")
    groups.sort(
      (a, b) =>
        Math.abs(b.values[SUM_KEY] ?? 0) - Math.abs(a.values[SUM_KEY] ?? 0),
    );
  return groups;
}

/**
 * The Proventos 12m look (monthly bars of the total or by class) is drawn by
 * the original income chart; any other chart config uses the shared renderers.
 */
export function usesLegacyIncomeChart(
  config: Pick<OpsViewConfig, "groupBy">,
  chart: InvestChart<OpsMetric>,
): boolean {
  return (
    opsChartAxis(config.groupBy) === "month" &&
    chart.type === "bar" &&
    chart.metric === "sum" &&
    !chart.cumulative &&
    chart.top === 0
  );
}

/** The config with another layout (everything else kept). */
export function withLayout<C extends { layout: "table" | "chart" }>(
  config: C,
  layout: "table" | "chart",
): C {
  return { ...config, layout };
}
