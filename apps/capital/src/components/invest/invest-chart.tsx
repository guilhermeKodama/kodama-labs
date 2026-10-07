"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { EmptyRow, Panel } from "@/components/cap";
import {
  CartesianBody,
  PieBody,
  TreemapBody,
} from "@/components/ledger/layouts/chart";
import { useNames } from "@/lib/api/catalog";
import { useFmt } from "@/lib/format/provider";
import {
  holdingsChartGroups,
  normalizeHoldingsChart,
  normalizeOpsChart,
  opsChartAxis,
  opsChartGroups,
} from "@/lib/invest/chart-view";
import type {
  HoldingsTable,
  HoldingsViewConfig,
} from "@/lib/invest/holdings-view";
import type { OpsViewConfig } from "@/lib/invest/ops-view";
import type { AllocationClass, Operation } from "@/lib/invest/types";
import {
  buildChartData,
  type ChartCategory,
  type ChartData,
} from "@/lib/ledger/chart-data";
import type { ChartType } from "@/lib/ledger/columns";
import { CUMULATIVE_TYPES } from "@/lib/ledger/columns";

type Metric = "sum" | "count" | "avg";

/** The ledger's chart bodies for a built ChartData (the type picks the renderer). */
function ChartBody({
  data,
  type,
  metric,
  catLabel,
  seriesLabel,
  value,
}: {
  data: ChartData;
  type: ChartType;
  metric: Metric;
  catLabel: (cat: ChartCategory) => string;
  seriesLabel: (key: string | null) => string;
  value: (v: number) => string;
}): ReactNode {
  const t = useTranslations("ledger");
  if (!data.categories.length)
    return <EmptyRow className="border-t-0">{t("charts.empty")}</EmptyRow>;
  if (type === "pie" || type === "donut")
    return (
      <PieBody
        data={data}
        metric={metric}
        donut={type === "donut"}
        catLabel={catLabel}
        value={value}
        onSlice={() => {}}
      />
    );
  if (type === "treemap")
    return (
      <TreemapBody
        data={data}
        catLabel={catLabel}
        onTile={() => {}}
        value={value}
      />
    );
  return (
    <CartesianBody
      data={data}
      type={type}
      catLabel={catLabel}
      seriesLabel={seriesLabel}
      value={value}
      onPoint={() => {}}
    />
  );
}

function ChartPanel({
  viewName,
  type,
  caption,
  children,
}: {
  viewName: string;
  type: ChartType;
  caption: string;
  children: ReactNode;
}) {
  const t = useTranslations("ledger");
  return (
    <Panel
      title={t("charts.title", {
        view: viewName,
        type: t(`charts.types.${type}`),
      })}
    >
      <div className="flex flex-col gap-2">
        {children}
        <span className="text-body-sm text-fg-4">{caption}</span>
      </div>
    </Panel>
  );
}

/** Chart layout of a holdings view: its groups (or each asset) by market value, share or result. */
export function HoldingsChart({
  config,
  table,
  viewName,
  currency,
}: {
  config: HoldingsViewConfig;
  table: HoldingsTable;
  viewName: string;
  currency: string | undefined;
}) {
  const t = useTranslations("invest.portfolio");
  const ti = useTranslations("invest");
  const tl = useTranslations("ledger");
  const fmt = useFmt();
  const names = useNames();
  const chart = normalizeHoldingsChart(config.chart);
  const adapted = useMemo(
    () => holdingsChartGroups(table, config.groupBy, chart.metric),
    [table, config.groupBy, chart.metric],
  );
  const data = useMemo(
    () =>
      buildChartData(adapted.groups, {
        type: chart.type,
        metric: adapted.buildMetric,
        cumulative: false,
        top: chart.top,
        hasSeries: false,
      }),
    [adapted, chart.type, chart.top],
  );
  const catLabel = (cat: ChartCategory): string => {
    if (cat.others) return tl("charts.others");
    const key = cat.key ?? "";
    if (config.groupBy === "none") {
      const row = adapted.rows.get(key);
      return row
        ? row.kind === "cash"
          ? t("cashTicker")
          : (row.ticker ?? row.name ?? "—")
        : key;
    }
    if (config.groupBy === "allocationClass")
      return ti(`allocationClass.${key as AllocationClass}`);
    if (!key) return t("severalBrokers");
    return (
      (config.groupBy === "accountId"
        ? names.account.get(key)
        : names.entity.get(key)) ?? key
    );
  };
  const value = (v: number) =>
    adapted.unit === "pct" ? fmt.pct(v, 1) : fmt.money0(v, currency);
  const metricLabel = t(`display.metrics.${chart.metric}`);
  const caption = [
    config.groupBy === "none"
      ? t("columns.ticker")
      : t(`display.group.${config.groupBy}`),
    metricLabel,
    ...(chart.top ? [tl("charts.topSuffix", { n: chart.top })] : []),
  ].join(" · ");
  return (
    <ChartPanel viewName={viewName} type={chart.type} caption={caption}>
      <ChartBody
        data={data}
        type={chart.type}
        metric={adapted.buildMetric}
        catLabel={catLabel}
        seriesLabel={() => metricLabel}
        value={value}
      />
    </ChartPanel>
  );
}

/** Chart layout of an operations view (shared renderers; Proventos 12m keeps its own bars). */
export function OpsChart({
  config,
  ops,
  today,
  rateFor,
  viewName,
  currency,
  rangeLabel,
}: {
  config: OpsViewConfig;
  ops: readonly Operation[];
  today: string;
  rateFor: (currency: string | null) => number;
  viewName: string;
  currency: string;
  rangeLabel: string;
}) {
  const t = useTranslations("invest.portfolio");
  const ti = useTranslations("invest");
  const tl = useTranslations("ledger");
  const fmt = useFmt();
  const chart = normalizeOpsChart(config.chart);
  const axis = opsChartAxis(config.groupBy);
  const groups = useMemo(
    () => opsChartGroups(ops, config, today, rateFor),
    [ops, config, today, rateFor],
  );
  const hasSeries =
    config.series === "allocationClass" && axis !== "allocationClass";
  const data = useMemo(
    () =>
      buildChartData(groups, {
        type: chart.type,
        metric: chart.metric,
        cumulative: chart.cumulative,
        top: chart.top,
        hasSeries,
      }),
    [groups, chart.type, chart.metric, chart.cumulative, chart.top, hasSeries],
  );
  const catLabel = (cat: ChartCategory): string => {
    if (cat.others) return tl("charts.others");
    const key = cat.key ?? "";
    if (axis === "month") return fmt.monthAbbr(Number(key.slice(5, 7)));
    return axis === "type"
      ? ti(`opType.${key as "buy"}`)
      : ti(`allocationClass.${key as AllocationClass}`);
  };
  const metricLabel =
    chart.metric === "count"
      ? tl("charts.metrics.count")
      : chart.metric === "avg"
        ? tl("charts.metrics.avg")
        : t("ops.total");
  const seriesLabel = (key: string | null) =>
    hasSeries && key
      ? ti(`allocationClass.${key as AllocationClass}`)
      : metricLabel;
  const value = (v: number) =>
    chart.metric === "count" ? fmt.number(v, 0) : fmt.money0(v, currency);
  const cumulative = chart.cumulative && CUMULATIVE_TYPES.includes(chart.type);
  const caption = [
    `${t(`display.axis.${axis}`)}${hasSeries ? ` × ${t("display.seriesClass")}` : ""}`,
    metricLabel,
    ...(cumulative ? [tl("charts.cumulative")] : []),
    ...(chart.top && chart.type !== "line" && chart.type !== "area"
      ? [tl("charts.topSuffix", { n: chart.top })]
      : []),
    rangeLabel,
  ].join(" · ");
  return (
    <ChartPanel viewName={viewName} type={chart.type} caption={caption}>
      <ChartBody
        data={data}
        type={chart.type}
        metric={chart.metric}
        catLabel={catLabel}
        seriesLabel={seriesLabel}
        value={value}
      />
    </ChartPanel>
  );
}
