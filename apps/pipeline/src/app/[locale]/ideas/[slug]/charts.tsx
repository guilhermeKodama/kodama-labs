"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import type { DailyPoint } from "@pipeline/server/lib/rollup";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

// Thin direct integration — the echarts-for-react wrapper doesn't mount under
// React 19/Next 16. Init once, setOption on data changes, resize with the card.
function EChart({ option, height }: { option: EChartsOption; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ height }} />;
}

interface ChartsProps {
  daily: DailyPoint[];
  cacCeilingCents: number | null;
}

// Refined dark palette — desaturated, flat. No glow. Spend bars in neutral ink;
// metric lines in muted, distinguishable hues.
const C = {
  spend: "rgba(180,180,185,0.42)",
  cpl: "#c1925e", // muted amber
  cac: "#c66a6a", // muted red
  ctr: "#7f93b8", // muted slate-blue
  bounce: "#9786b0", // muted violet-gray
  grid: "rgba(160,160,165,0.1)",
  axis: "rgba(160,160,165,0.7)",
  text: "#e6e6e8",
  tooltipBg: "rgba(26,26,28,0.96)",
  tooltipBorder: "rgba(160,160,165,0.2)",
};

const flatLine = (color: string) => ({ width: 2, color });

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(v);

function buildPoints(daily: DailyPoint[]) {
  let cumSpend = 0;
  let cumCustomers = 0;
  return daily.map((d) => {
    cumSpend += d.spendCents;
    cumCustomers += d.customers;
    return {
      date: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
      spend: d.spendCents / 100,
      cpl: d.leads > 0 ? d.spendCents / d.leads / 100 : null,
      cacRunning: cumCustomers > 0 ? cumSpend / cumCustomers / 100 : null,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null,
      bounce: d.sessions > 0 ? (1 - d.engagedSessions / d.sessions) * 100 : null,
    };
  });
}

const baseAxis = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: C.axis, fontSize: 11 },
} as const;

const baseTooltip = {
  trigger: "axis" as const,
  borderColor: C.tooltipBorder,
  backgroundColor: C.tooltipBg,
  textStyle: { color: C.text, fontSize: 12 },
  padding: [8, 12],
  extraCssText: "border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.4);",
};

const baseLegend = {
  bottom: 0,
  icon: "roundRect",
  itemWidth: 10,
  itemHeight: 10,
  textStyle: { color: C.axis, fontSize: 11 },
} as const;

// fixed margins — ECharts v6 deprecated grid.containLabel
const moneyGrid = { left: 58, right: 16, top: 16, bottom: 52 } as const;
const ratesGrid = { left: 46, right: 16, top: 16, bottom: 52 } as const;

export function IdeaCharts({ daily, cacCeilingCents }: ChartsProps) {
  const t = useTranslations("idea.charts");
  const points = buildPoints(daily);

  if (points.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8">
        <p className="text-sm text-muted-foreground text-center">{t("noData")}</p>
      </div>
    );
  }

  const dates = points.map((p) => p.date);

  const moneyOption: EChartsOption = {
    animationDuration: 500,
    grid: moneyGrid,
    tooltip: {
      ...baseTooltip,
      axisPointer: { type: "shadow", shadowStyle: { opacity: 0.06 } },
      valueFormatter: (v) => (typeof v === "number" ? brl(v) : "—"),
    },
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseAxis },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: C.grid, type: "dashed" } },
      ...baseAxis,
      axisLabel: {
        ...baseAxis.axisLabel,
        formatter: (v: number) =>
          v >= 1000 ? `R$${(v / 1000).toFixed(1).replace(".", ",")}k` : `R$${v}`,
      },
    },
    series: [
      {
        name: t("spend"),
        type: "bar",
        data: points.map((p) => p.spend),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0], color: C.spend },
      },
      {
        name: "CPL",
        type: "line",
        data: points.map((p) => p.cpl),
        smooth: 0.3,
        connectNulls: true,
        showSymbol: false,
        lineStyle: flatLine(C.cpl),
        itemStyle: { color: C.cpl },
      },
      {
        name: t("cacRunning"),
        type: "line",
        data: points.map((p) => p.cacRunning),
        smooth: 0.3,
        connectNulls: true,
        showSymbol: false,
        lineStyle: flatLine(C.cac),
        itemStyle: { color: C.cac },
        ...(cacCeilingCents != null
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                lineStyle: { color: C.cac, type: "dashed", opacity: 0.7 },
                label: {
                  formatter: t("cacCeiling"),
                  position: "insideEndTop",
                  color: C.cac,
                  fontSize: 10,
                },
                data: [{ yAxis: cacCeilingCents / 100 }],
              },
            }
          : {}),
      },
    ],
  };

  const ratesOption: EChartsOption = {
    animationDuration: 500,
    grid: ratesGrid,
    tooltip: {
      ...baseTooltip,
      axisPointer: { type: "line", lineStyle: { color: C.axis, opacity: 0.4 } },
      valueFormatter: (v) =>
        typeof v === "number" ? `${v.toFixed(1).replace(".", ",")}%` : "—",
    },
    legend: baseLegend,
    xAxis: { type: "category", data: dates, ...baseAxis },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: C.grid, type: "dashed" } },
      ...baseAxis,
      axisLabel: { ...baseAxis.axisLabel, formatter: "{value}%" },
    },
    series: [
      {
        name: "CTR",
        type: "line",
        data: points.map((p) => p.ctr),
        smooth: 0.3,
        connectNulls: true,
        showSymbol: false,
        lineStyle: flatLine(C.ctr),
        itemStyle: { color: C.ctr },
      },
      {
        name: t("bounce"),
        type: "line",
        data: points.map((p) => p.bounce),
        smooth: 0.3,
        connectNulls: true,
        showSymbol: false,
        lineStyle: flatLine(C.bounce),
        itemStyle: { color: C.bounce },
      },
    ],
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-2">{t("spendCplCac")}</h3>
        <EChart option={moneyOption} height={240} />
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-2">{t("ctrBounce")}</h3>
        <EChart option={ratesOption} height={240} />
      </div>
    </div>
  );
}
