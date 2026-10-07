"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GroupKey, LedgerFilter, LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Callout, EmptyRow, Panel } from "@/components/cap";
import { useFmt } from "@/lib/format/provider";
import { buildChartData, pieItems, waterfallItems, type ChartCategory, type ChartData } from "@/lib/ledger/chart-data";
import { CHART_TYPE_META, CUMULATIVE_TYPES, groupIdOf, type ChartType } from "@/lib/ledger/columns";
import { othersFilters, type DrillCell } from "@/lib/ledger/drill";
import { layoutTreemap, showsTreemapLabel, treemapShade, TREEMAP_H, TREEMAP_W } from "@/lib/ledger/treemap";
import { chartKeys } from "@/lib/ledger/view-query";
import { waterfallBar, waterfallScale, waterfallSteps } from "@/lib/ledger/waterfall";
import { CHART, CHART_AXIS, CHART_SERIES } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";

const TOOLTIP_STYLE = {
  contentStyle: { background: "var(--cap-bg-editor)", border: "1px solid var(--cap-stroke-1)", borderRadius: 8, fontSize: textRole("body-sm") },
  labelStyle: { color: "var(--cap-text-2)" },
} as const;
const SHADE = { 1: "bg-fill-1", 2: "bg-fill-2", 3: "bg-fill-3", 4: "bg-fill-4" } as const;
const color = (index: number) => CHART_SERIES[index % CHART_SERIES.length];

/** Chart types above the chart (mockup 2925–2950): icon and label, the hint as title. */
export function ChartTypeStrip({ type, onType }: { type: ChartType; onType: (type: ChartType) => void }) {
  const t = useTranslations("ledger.charts");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHART_TYPE_META.map((meta) => (
        <button
          key={meta.type}
          type="button"
          title={t(`hints.${meta.type}`)}
          onClick={() => onType(meta.type)}
          className={cn(
            "inline-flex h-6 items-center gap-[5px] rounded-[6px] border px-2 text-label",
            type === meta.type ? "border-stroke-1 bg-fill-2 text-fg-1" : "border-transparent text-fg-3 hover:text-fg-strong",
          )}
        >
          <meta.icon aria-hidden className="size-3.5 shrink-0" />
          {t(`types.${meta.type}`)}
        </button>
      ))}
    </div>
  );
}

interface DrillTarget {
  onDrill: (cells: DrillCell[]) => void;
  onDrillFilters: (keys: GroupKey[], filters: LedgerFilter[]) => void;
}

/**
 * A chart view (mockup chartLayout 2863–2958): the type strip, then a
 * Panel "{view} · {tipo}" with the chart and its caption (axis × series ·
 * metric · acumulado · top N · period). Bars, slices, tiles and steps
 * open the table with that slice.
 */
export function ChartView({
  groups,
  config,
  viewName,
  rangeLabel,
  labels,
  onType,
  onDrill,
  onDrillFilters,
  sankey,
}: {
  groups: readonly LedgerGroup[];
  config: ViewConfig;
  viewName: string;
  rangeLabel: string;
  labels: LedgerLabels;
  onType: (type: ChartType) => void;
  /** The sankey body, drawn by its own component (it has its own endpoint). */
  sankey?: ReactNode;
} & DrillTarget) {
  const t = useTranslations("ledger");
  const fmt = useFmt();
  const { type, metric, cumulative, top } = config.chart;
  const { axis, series: seriesKey } = chartKeys(config);
  const data = buildChartData(groups, { type, metric, cumulative, top, hasSeries: !!seriesKey, timeSeries: !!seriesKey && "bucket" in seriesKey });
  const metricLabel = type === "waterfall" ? t("charts.signed", { currency: fmt.currencySymbol() }) : t(`charts.metrics.${metric}`);
  const catLabel = (cat: ChartCategory) => (cat.others ? t("charts.others") : labels.groupValue(axis, cat.key));
  const seriesLabel = (key: string | null) => (seriesKey ? labels.groupValue(seriesKey, key) : metricLabel);
  const value = (v: number) => (type === "bar100" ? fmt.pct(v, 0) : metric === "count" ? fmt.number(v, 0) : fmt.money0(v));

  const drillAt = (index: number, seriesIndex?: number) => {
    const cat = data.categories[index];
    if (!cat) return;
    if (cat.others) {
      const kept = data.categories.filter((c) => !c.others).map((c) => c.key);
      const filters = othersFilters(axis, kept, cat.others);
      if (filters) onDrillFilters([axis], filters);
      return;
    }
    const cells: DrillCell[] = [{ key: axis, value: cat.key }];
    const s = seriesIndex !== undefined && seriesKey ? data.series[seriesIndex] : null;
    if (s && seriesKey) cells.push({ key: seriesKey, value: s.key });
    onDrill(cells);
  };

  const useCum = cumulative && CUMULATIVE_TYPES.includes(type);
  const caption = [
    `${labels.prop(groupIdOf(axis))}${data.hasSeries && seriesKey ? ` × ${labels.prop(groupIdOf(seriesKey))}` : ""}`,
    metricLabel,
    ...(useCum ? [t("charts.cumulative")] : []),
    ...(top && type !== "line" && type !== "area" && type !== "sankey" ? [t("charts.topSuffix", { n: top })] : []),
    rangeLabel,
  ].join(" · ");
  const typeLabel = t(`charts.types.${type}`);

  let body: ReactNode;
  if (type === "sankey") body = sankey;
  else if (!data.categories.length) body = <EmptyRow className="border-t-0">{t("charts.empty")}</EmptyRow>;
  else if (type === "bar100" && !data.hasSeries) {
    body = (
      <Callout tone="info" title={t("charts.bar100Title")}>
        {t("charts.bar100Body")}
      </Callout>
    );
  } else if (type === "pie" || type === "donut") body = <PieBody data={data} metric={metric} donut={type === "donut"} catLabel={catLabel} value={value} onSlice={(i) => drillAt(i)} />;
  else if (type === "treemap") body = <TreemapBody data={data} catLabel={catLabel} onTile={(i) => drillAt(i)} />;
  else if (type === "waterfall") body = <WaterfallBody data={data} catLabel={catLabel} resultLabel={t("charts.result")} onStep={(i) => drillAt(i)} />;
  else body = <CartesianBody data={data} type={type} catLabel={catLabel} seriesLabel={seriesLabel} value={value} onPoint={drillAt} />;

  return (
    <div className="flex flex-col gap-2">
      <ChartTypeStrip type={type} onType={onType} />
      <Panel title={t("charts.title", { view: viewName, type: typeLabel })}>
        <div className="flex flex-col gap-2">
          {body}
          {type !== "sankey" ? <span className="text-body-sm text-fg-4">{caption}</span> : null}
        </div>
      </Panel>
    </div>
  );
}

/** Bars (stacked with series), horizontal, 100%, line and area. */
export function CartesianBody({
  data,
  type,
  catLabel,
  seriesLabel,
  value,
  onPoint,
}: {
  data: ChartData;
  type: ChartType;
  catLabel: (cat: ChartCategory) => string;
  seriesLabel: (key: string | null) => string;
  value: (v: number) => string;
  onPoint: (index: number, seriesIndex?: number) => void;
}) {
  const rows = data.categories.map((cat, i) => ({
    name: catLabel(cat),
    ...Object.fromEntries(data.series.map((s, j) => [`s${j}`, s.values[i]])),
  }));
  const horizontal = type === "hbar";
  const height = horizontal ? Math.max(200, data.categories.length * 28) : 260;
  const stacked = data.hasSeries;
  const tick = (v: number) => value(Number(v));
  const legend = data.hasSeries ? <Legend iconSize={8} wrapperStyle={{ fontSize: textRole("caption") }} /> : null;
  const tooltip = <Tooltip {...TOOLTIP_STYLE} formatter={(v) => tick(Number(v))} />;
  const seriesColor = (j: number) => (data.hasSeries ? color(j) : CHART.bar);
  const many = data.categories.length > 8;

  if (type === "line" || type === "area") {
    const Chart = type === "line" ? LineChart : AreaChart;
    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} onClick={(state) => typeof state?.activeTooltipIndex === "number" && onPoint(state.activeTooltipIndex)}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="name" {...CHART_AXIS} interval="preserveStartEnd" />
            <YAxis {...CHART_AXIS} tickFormatter={tick} width={80} />
            {tooltip}
            {legend}
            {data.series.map((s, j) =>
              type === "line" ? (
                <Line key={j} dataKey={`s${j}`} name={seriesLabel(s.key)} stroke={data.hasSeries ? color(j) : CHART.ink} strokeWidth={2} dot={false} className="cursor-pointer" />
              ) : (
                <Area key={j} dataKey={`s${j}`} name={seriesLabel(s.key)} stroke={data.hasSeries ? color(j) : CHART.ink} fill={data.hasSeries ? color(j) : CHART.area} fillOpacity={data.hasSeries ? 0.15 : 1} className="cursor-pointer" />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} stackOffset={type === "bar100" ? "expand" : undefined}>
          <CartesianGrid stroke={CHART.grid} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...CHART_AXIS} tickFormatter={tick} />
              <YAxis type="category" dataKey="name" {...CHART_AXIS} width={140} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" {...CHART_AXIS} interval={0} angle={many ? -30 : 0} textAnchor={many ? "end" : "middle"} height={many ? 60 : 30} />
              <YAxis {...CHART_AXIS} tickFormatter={tick} width={80} />
            </>
          )}
          {tooltip}
          {legend}
          {data.series.map((s, j) => (
            <Bar
              key={j}
              dataKey={`s${j}`}
              name={seriesLabel(s.key)}
              stackId={stacked ? "stack" : undefined}
              fill={seriesColor(j)}
              radius={stacked ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
              className="cursor-pointer"
              onClick={(_, index) => onPoint(index, data.hasSeries ? j : undefined)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pie and donut (positive values only), with the total in the donut's center and a legend. */
export function PieBody({
  data,
  metric,
  donut,
  catLabel,
  value,
  onSlice,
}: {
  data: ChartData;
  metric: ViewConfig["chart"]["metric"];
  donut: boolean;
  catLabel: (cat: ChartCategory) => string;
  value: (v: number) => string;
  onSlice: (index: number) => void;
}) {
  const fmt = useFmt();
  const items = pieItems(data, metric).map((item) => ({ ...item, index: data.categories.indexOf(item.category) }));
  const total = items.reduce((s, item) => s + item.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-[220px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => value(Number(v))} />
            <Pie
              data={items.map((item) => ({ name: catLabel(item.category), value: item.value }))}
              dataKey="value"
              nameKey="name"
              innerRadius={donut ? 64 : 0}
              outerRadius={104}
              stroke="var(--cap-bg-editor)"
              isAnimationActive={false}
              onClick={(_, index) => onSlice(items[index].index)}
              className="cursor-pointer"
            >
              {items.map((item, i) => (
                <Cell key={item.index} fill={color(i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {donut ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-body-lg font-semibold tabular-nums">{value(total)}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {items.map((item, i) => (
          <button key={item.index} type="button" onClick={() => onSlice(item.index)} className="flex items-center gap-2 text-left text-body-sm hover:underline">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color(i) }} />
            <span className="min-w-0 flex-1 truncate">{catLabel(item.category)}</span>
            <span className="font-mono text-fg-2 tabular-nums">{value(item.value)}</span>
            <span className="w-10 text-right font-mono text-caption text-fg-3 tabular-nums">{fmt.pct(total ? item.value / total : 0, 0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Treemap (mockup 1906–1960): tiles by value, shaded by rank, labelled when large enough. */
export function TreemapBody({ data, catLabel, onTile, value }: { data: ChartData; catLabel: (cat: ChartCategory) => string; onTile: (index: number) => void; value?: (v: number) => string }) {
  const fmt = useFmt();
  const items = data.categories.map((category, index) => ({ value: data.totals[index], data: { category, index } }));
  const total = items.reduce((s, item) => s + Math.max(0, item.value), 0);
  const rects = layoutTreemap(items);
  return (
    <div className="relative h-[260px]">
      {rects.map((r) => (
        <button
          key={r.data.index}
          type="button"
          title={catLabel(r.data.category)}
          onClick={() => onTile(r.data.index)}
          className="absolute box-border p-0.5 text-left"
          style={{ left: `${(r.x / TREEMAP_W) * 100}%`, top: `${(r.y / TREEMAP_H) * 100}%`, width: `${(r.w / TREEMAP_W) * 100}%`, height: `${(r.h / TREEMAP_H) * 100}%` }}
        >
          <span className={cn("box-border flex h-full flex-col gap-0.5 overflow-hidden rounded-[5px] p-2 hover:opacity-90", SHADE[treemapShade(r.rank)])}>
            {showsTreemapLabel(r) ? (
              <>
                <span className="truncate text-body-sm font-semibold">{catLabel(r.data.category)}</span>
                <span className="font-mono text-caption text-fg-2 tabular-nums">{value ? value(r.value) : fmt.money0(r.value)}</span>
                <span className="font-mono text-hint text-fg-3 tabular-nums">{fmt.pct(total ? r.value / total : 0, 0)}</span>
              </>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Waterfall (mockup 1962–2011): incomes up, expenses down, then the Resultado bar. */
function WaterfallBody({
  data,
  catLabel,
  resultLabel,
  onStep,
}: {
  data: ChartData;
  catLabel: (cat: ChartCategory) => string;
  resultLabel: string;
  onStep: (index: number) => void;
}) {
  const fmt = useFmt();
  const height = 240;
  const steps = waterfallSteps(waterfallItems(data).map((item) => ({ value: item.value, data: data.categories.indexOf(item.category) })));
  const y = waterfallScale(steps, height);
  const label = (index: number | null) => (index === null ? resultLabel : catLabel(data.categories[index]));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex gap-1.5" style={{ height }}>
        <span className="absolute right-0 left-0 h-px bg-stroke-1" style={{ top: y(0) }} />
        {steps.map((step, i) => {
          const bar = waterfallBar(step, y);
          return (
            <button
              key={i}
              type="button"
              disabled={step.data === null}
              onClick={() => step.data !== null && onStep(step.data)}
              title={label(step.data)}
              className="relative min-w-0 flex-1 disabled:cursor-default"
            >
              <span className="absolute right-0 left-0 text-center font-mono text-micro whitespace-nowrap text-fg-3 tabular-nums" style={{ top: Math.max(0, bar.top - 15) }}>
                {fmt.k(step.value)}
              </span>
              <span
                className={cn("absolute right-[12%] left-[12%] rounded-[3px]", step.kind === "pos" ? "bg-pos" : step.kind === "neg" ? "bg-fg-3" : "bg-fg-1")}
                style={{ top: bar.top, height: bar.height }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {steps.map((step, i) => (
          <span key={i} className={cn("min-w-0 flex-1 truncate text-center text-hint", step.kind === "total" ? "text-fg-1" : "text-fg-3")}>
            {label(step.data)}
          </span>
        ))}
      </div>
    </div>
  );
}

