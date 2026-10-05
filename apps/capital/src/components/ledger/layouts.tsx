"use client";

import { useMemo } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GroupKey, LedgerFilter, LedgerGroup, LedgerQueryResult, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { Names } from "@/lib/catalog";
import { dayLabel, money, money0 } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EmptyRow } from "@/components/shell/chrome";
import { CHART, CHART_AXIS, CHART_SERIES, heatColor } from "@/lib/theme/chart-colors";
import { groupValueLabel } from "./fields";
import type { DisplayRow } from "./rows";

const PALETTE = CHART_SERIES;

/** Filters that select one group value, for click-through. Date buckets are not drillable. */
export function drillFilter(key: GroupKey | undefined, value: string | null): LedgerFilter | null {
  if (!key || "bucket" in key) return null;
  if (value === null) return { field: key.field, op: "isNull" };
  const typed: string | boolean = key.field === "isTaxDeductible" || key.field === "isRecurring" ? value === "true" : value;
  return { field: key.field, op: "in", values: [typed] };
}

export function PivotView({
  pivot,
  config,
  names,
  onDrill,
}: {
  pivot: NonNullable<LedgerQueryResult["pivot"]>;
  config: ViewConfig;
  names: Names;
  onDrill: (filters: LedgerFilter[]) => void;
}) {
  const [rowKey, colKey] = config.groupBy;
  const cur = names.currency;
  const drill = (r: string | null, c: string | null) => {
    const filters = [drillFilter(rowKey, r), drillFilter(colKey, c)].filter(Boolean) as LedgerFilter[];
    if (filters.length) onDrill(filters);
  };
  if (!pivot.rowKeys.length) return <div className="rounded-lg border border-stroke-3"><EmptyRow>Nada para cruzar neste recorte.</EmptyRow></div>;
  return (
    <div className="overflow-auto rounded-lg border border-stroke-3">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="h-[34px] text-[11.5px] text-fg-3">
            <th className="px-3 text-left font-normal">{rowKey ? "" : ""}</th>
            {pivot.colKeys.map((c) => (
              <th key={String(c)} className="px-3 text-right font-normal whitespace-nowrap">{colKey ? groupValueLabel(colKey, c, names) : ""}</th>
            ))}
            <th className="px-3 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {pivot.rowKeys.map((r, i) => (
            <tr key={String(r)} className="h-[34px] border-t border-stroke-3">
              <td className="px-3 whitespace-nowrap">{rowKey ? groupValueLabel(rowKey, r, names) : ""}</td>
              {pivot.cells[i].map((v, j) => (
                <td key={j} className="px-3 text-right">
                  {v == null ? <span className="text-fg-4">—</span> : (
                    <button type="button" className={cn("font-mono tabular-nums hover:underline", v > 0 && "text-pos")} onClick={() => drill(r, pivot.colKeys[j])}>
                      {money0(v, cur)}
                    </button>
                  )}
                </td>
              ))}
              <td className="px-3 text-right font-mono font-semibold tabular-nums">{pivot.rowTotals[i] == null ? "" : money0(pivot.rowTotals[i]!, cur)}</td>
            </tr>
          ))}
          <tr className="h-[34px] border-t border-stroke-1 bg-fill-4 font-semibold">
            <td className="px-3">Total</td>
            {pivot.colTotals.map((v, j) => (
              <td key={j} className="px-3 text-right font-mono tabular-nums">{v == null ? "" : money0(v, cur)}</td>
            ))}
            <td className="px-3 text-right font-mono tabular-nums">{pivot.grandTotal == null ? "" : money0(pivot.grandTotal, cur)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ChartView({
  groups,
  config,
  names,
  onDrill,
}: {
  groups: LedgerGroup[];
  config: ViewConfig;
  names: Names;
  onDrill: (filters: LedgerFilter[]) => void;
}) {
  const key = config.groupBy[0];
  const { type, metric, cumulative } = config.chart;
  const data = useMemo(() => {
    const raw = groups.map((g) => {
      const sum = g.values["sum:amountBase"] ?? 0;
      const v = metric === "count" ? g.count : metric === "avg" ? (g.count ? sum / g.count : 0) : sum;
      return { key: g.key, name: key ? groupValueLabel(key, g.key, names) : "", raw: v };
    });
    const flip = metric !== "count" && raw.every((d) => d.raw <= 0);
    const isDate = key && "bucket" in key;
    const ordered = isDate ? [...raw].sort((a, b) => String(a.key).localeCompare(String(b.key))) : raw;
    return ordered.reduce<{ points: { key: (typeof ordered)[number]["key"]; name: string; raw: number; value: number }[]; acc: number }>(
      (state, d) => {
        const value = flip ? -d.raw : d.raw;
        const acc = state.acc + value;
        return {
          acc,
          points: [...state.points, { ...d, value: Math.round((cumulative ? acc : value) * 100) / 100 }],
        };
      },
      { points: [], acc: 0 },
    ).points;
  }, [groups, key, metric, cumulative, names]);

  if (!data.length) return <div className="rounded-lg border border-stroke-3"><EmptyRow>Sem dados para o gráfico neste recorte.</EmptyRow></div>;
  const fmt = (v: number) => (metric === "count" ? String(v) : money0(v, names.currency));
  const click = (d: { key?: string | null }) => {
    const f = drillFilter(key, d.key ?? null);
    if (f) onDrill([f]);
  };
  const axis = CHART_AXIS;

  return (
    <div className="rounded-lg border border-stroke-3 p-3">
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          {type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis dataKey="name" {...axis} />
              <YAxis {...axis} tickFormatter={fmt} width={80} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Line dataKey="value" stroke={CHART.ink} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          ) : type === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis dataKey="name" {...axis} />
              <YAxis {...axis} tickFormatter={fmt} width={80} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Area dataKey="value" stroke={CHART.ink} fill={CHART.area} />
            </AreaChart>
          ) : type === "pie" || type === "donut" ? (
            <PieChart>
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" innerRadius={type === "donut" ? 70 : 0} outerRadius={130} onClick={(d) => click(d as { key?: string | null })} label={(d) => String(d.name)}>
                {data.map((d, i) => <Cell key={String(d.key)} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={data} layout={type === "hbar" ? "vertical" : "horizontal"}>
              <CartesianGrid stroke={CHART.grid} />
              {type === "hbar" ? (
                <>
                  <XAxis type="number" {...axis} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="name" {...axis} width={140} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" {...axis} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 60 : 30} />
                  <YAxis {...axis} tickFormatter={fmt} width={80} />
                </>
              )}
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="value" fill={CHART.bar} radius={[3, 3, 0, 0]} onClick={(d) => click(d as unknown as { key?: string | null })} className="cursor-pointer" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-fg-3">Clique numa barra ou fatia para ver os lançamentos.</p>
    </div>
  );
}

type FlowNode = { name: string };
type FlowLink = { source: number; target: number; value: number };

export function SankeyView({ groups, names }: { groups: LedgerGroup[]; names: Names }) {
  const layout = useMemo(() => {
    const income = groups.find((g) => g.key === "income")?.children ?? [];
    const outs = [...(groups.find((g) => g.key === "expense")?.children ?? []), ...(groups.find((g) => g.key === "investment")?.children ?? [])];
    const inTotal = income.reduce((s, g) => s + Math.abs(g.values["sum:amountBase"] ?? 0), 0);
    const outTotal = outs.reduce((s, g) => s + Math.abs(g.values["sum:amountBase"] ?? 0), 0);
    if (!inTotal && !outTotal) return null;
    const nodes: FlowNode[] = [];
    const links: FlowLink[] = [];
    const label = (key: string | null) => (key ? names.category.get(key) ?? "?" : "Sem categoria");
    const hub = 0;
    nodes.push({ name: "Caixa" });
    for (const g of income) {
      nodes.push({ name: label(g.key) });
      links.push({ source: nodes.length - 1, target: hub, value: Math.abs(g.values["sum:amountBase"] ?? 0) });
    }
    if (outTotal > inTotal) {
      nodes.push({ name: "Do saldo" });
      links.push({ source: nodes.length - 1, target: hub, value: outTotal - inTotal });
    }
    for (const g of [...outs].sort((a, b) => Math.abs(b.values["sum:amountBase"] ?? 0) - Math.abs(a.values["sum:amountBase"] ?? 0))) {
      nodes.push({ name: label(g.key) });
      links.push({ source: hub, target: nodes.length - 1, value: Math.abs(g.values["sum:amountBase"] ?? 0) });
    }
    if (inTotal > outTotal) {
      nodes.push({ name: "Sobra" });
      links.push({ source: hub, target: nodes.length - 1, value: inTotal - outTotal });
    }
    const generator = sankey<FlowNode, FlowLink>().nodeWidth(10).nodePadding(10).extent([[1, 8], [899, 432]]);
    return generator({ nodes: nodes.map((n) => ({ ...n })), links: links.filter((l) => l.value > 0).map((l) => ({ ...l })) });
  }, [groups, names]);

  if (!layout) return <div className="rounded-lg border border-stroke-3"><EmptyRow>Sem entradas ou saídas neste recorte.</EmptyRow></div>;
  const path = sankeyLinkHorizontal();
  return (
    <div className="rounded-lg border border-stroke-3 p-3">
      <svg viewBox="0 0 900 440" className="w-full">
        {layout.links.map((link: SankeyLink<FlowNode, FlowLink>, i: number) => (
          <path key={i} d={path(link) ?? ""} fill="none" stroke={CHART.muted} strokeOpacity={0.35} strokeWidth={Math.max(1, link.width ?? 1)}>
            <title>{`${(link.source as SankeyNode<FlowNode, FlowLink>).name} → ${(link.target as SankeyNode<FlowNode, FlowLink>).name}: ${money0(link.value, names.currency)}`}</title>
          </path>
        ))}
        {layout.nodes.map((node: SankeyNode<FlowNode, FlowLink>, i: number) => {
          const left = (node.x0 ?? 0) < 450;
          return (
            <g key={i}>
              <rect x={node.x0} y={node.y0} width={(node.x1 ?? 0) - (node.x0 ?? 0)} height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))} fill={CHART.bar} />
              <text x={left ? (node.x1 ?? 0) + 6 : (node.x0 ?? 0) - 6} y={((node.y0 ?? 0) + (node.y1 ?? 0)) / 2} dy="0.35em" textAnchor={left ? "start" : "end"} fontSize={11} fill={CHART.label}>
                {node.name} · {money0(node.value ?? 0, names.currency)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BoardView({
  rows,
  groups,
  config,
  names,
  onOpen,
}: {
  rows: DisplayRow[];
  groups: LedgerGroup[];
  config: ViewConfig;
  names: Names;
  onOpen: (row: DisplayRow) => void;
}) {
  const key = config.groupBy[0];
  if (!key) return <div className="rounded-lg border border-stroke-3"><EmptyRow>Escolha um agrupamento em Exibição para montar as colunas.</EmptyRow></div>;
  const field = "bucket" in key ? null : key.field;
  const columnOf = (row: DisplayRow) => (field ? String(row[field as keyof DisplayRow] ?? "null") : row.date.slice(0, 7));
  return (
    <div className="flex min-h-0 gap-3 overflow-x-auto pb-2">
      {groups.map((g) => {
        const items = rows.filter((row) => columnOf(row) === String(g.key ?? "null"));
        return (
          <section key={String(g.key)} className="flex w-64 shrink-0 flex-col rounded-lg border border-stroke-3 bg-fill-4">
            <header className="flex h-9 items-center gap-2 border-b border-stroke-3 px-3 text-[12.5px]">
              <span className="truncate font-medium">{groupValueLabel(key, g.key, names)}</span>
              <span className="text-fg-3">{g.count}</span>
              <span className="ml-auto font-mono text-[12px] tabular-nums">{money0(g.values["sum:amountBase"] ?? 0, names.currency)}</span>
            </header>
            <div className="flex flex-col gap-1.5 p-2">
              {items.slice(0, 50).map((row) => (
                <button key={row.id} type="button" onClick={() => onOpen(row)} className="rounded-[6px] border border-stroke-3 bg-editor px-2 py-1.5 text-left text-[12.5px] hover:border-stroke-1">
                  <span className="block truncate">{row.description}</span>
                  <span className="flex items-center justify-between text-[11px] text-fg-3">
                    <span>{dayLabel(row.date)} · {row.categoryId ? names.category.get(row.categoryId) : "Sem categoria"}</span>
                    <span className={cn("font-mono tabular-nums text-fg-strong", row.amountBase > 0 && !row.neutral && "text-pos")}>{money(row.amountBase, names.currency)}</span>
                  </span>
                </button>
              ))}
              {items.length < g.count ? <span className="px-1 text-[11px] text-fg-3">+{g.count - items.length} não carregados</span> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CalendarView({
  rows,
  range,
  names,
  onDay,
}: {
  rows: DisplayRow[];
  range: { from: string | null; to: string | null };
  names: Names;
  onDay: (day: string) => void;
}) {
  const month = (range.to ?? rows[0]?.date ?? new Date().toISOString()).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = new Map<string, { out: number; inn: number; n: number }>();
  for (const row of rows) {
    if (row.neutral || !row.date.startsWith(month)) continue;
    const d = byDay.get(row.date) ?? { out: 0, inn: 0, n: 0 };
    if (row.amountBase < 0) d.out += row.amountBase;
    else d.inn += row.amountBase;
    d.n += 1;
    byDay.set(row.date, d);
  }
  const maxOut = Math.max(1, ...[...byDay.values()].map((d) => -d.out));
  return (
    <div className="rounded-lg border border-stroke-3 p-3">
      <div className="grid grid-cols-7 gap-1 text-[11px] text-fg-3">
        {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => <span key={d} className="px-1">{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => <span key={`pad${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
          const d = byDay.get(iso);
          return (
            <button
              key={iso}
              type="button"
              disabled={!d}
              onClick={() => onDay(iso)}
              className="flex h-[72px] flex-col items-start rounded-[6px] border border-stroke-3 p-1.5 text-left disabled:cursor-default"
              style={{ background: d ? heatColor(Number((0.04 + (-d.out / maxOut) * 0.18).toFixed(3))) : undefined }}
            >
              <span className="text-[11px] text-fg-3">{i + 1}</span>
              {d ? (
                <>
                  {d.out ? <span className="font-mono text-[11px] tabular-nums">{money0(d.out, names.currency)}</span> : null}
                  {d.inn ? <span className="font-mono text-[11px] text-pos tabular-nums">{money0(d.inn, names.currency)}</span> : null}
                  <span className="mt-auto text-[10px] text-fg-3">{d.n} lanç.</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
