"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatInt, formatMetricValue, formatPct } from "@/lib/format";
import { HEALTH_CLASSES } from "@/components/health";
import type {
  MetricHealth,
  MetricKeyT,
  MetricStatus,
  RawCounts,
} from "@/lib/funnel/types";

// ————————————————————————————————————————————————————————————————
// Stage / edge definitions
// ————————————————————————————————————————————————————————————————

interface StageDef {
  id: string;
  labelKey: string;
  prefix?: string;
  count: (c: RawCounts) => number; // drives the pipe height (log scale)
  value: (c: RawCounts) => string;
  split: (c: RawCounts) => string;
}

function compactInt(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1).replace(".", ",")}k`;
  return formatInt(value);
}

const STAGES: StageDef[] = [
  {
    id: "cost",
    labelKey: "cost",
    prefix: "R$",
    count: () => -1, // source reservoir: always full height
    value: (c) => formatInt(Math.round(c.spendCents / 100)),
    split: (c) => compactInt(Math.round(c.spendCents / 100)),
  },
  {
    id: "impressions",
    labelKey: "impressions",
    count: (c) => c.impressions,
    value: (c) => compactInt(c.impressions),
    split: (c) => compactInt(c.impressions),
  },
  {
    id: "clicks",
    labelKey: "clicks",
    count: (c) => c.clicks,
    value: (c) => formatInt(c.clicks),
    split: (c) => compactInt(c.clicks),
  },
  {
    id: "sessions",
    labelKey: "sessions",
    count: (c) => c.sessions,
    value: (c) => formatInt(c.sessions),
    split: (c) => compactInt(c.sessions),
  },
  {
    id: "leads",
    labelKey: "leads",
    count: (c) => c.leads,
    value: (c) => formatInt(c.leads),
    split: (c) => compactInt(c.leads),
  },
  {
    id: "active",
    labelKey: "active",
    count: (c) => c.activated,
    value: (c) => formatInt(c.activated),
    split: (c) => compactInt(c.activated),
  },
  {
    id: "customers",
    labelKey: "customers",
    count: (c) => c.customers,
    value: (c) => formatInt(c.customers),
    split: (c) => compactInt(c.customers),
  },
];

// Metric(s) measured on each pipe (between consecutive stages).
const EDGE_METRICS: MetricKeyT[][] = [
  ["CPM"],
  ["CTR"],
  ["BOUNCE_RATE"],
  ["SESSION_TO_LEAD", "CPL"],
  ["AR"],
  ["PCR"],
];

// Reference the desaturated theme tokens — status is the only color, kept quiet.
const STATUS_COLOR: Record<MetricStatus, string> = {
  healthy: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--destructive)",
  insufficient_data: "var(--muted-foreground)",
  neutral: "var(--muted-foreground)",
};

// ————————————————————————————————————————————————————————————————
// Geometry — fixed viewBox, scales uniformly with the container
// ————————————————————————————————————————————————————————————————

const W = 1240;
const H = 318;
const FLOW_TOP = 16;
const FLOW_H = 196; // pipes live in 16..212
const CY = FLOW_TOP + FLOW_H / 2;
const NODE_W = 54;
const NODE_MAX_H = FLOW_H - 8;
const NODE_MIN_H = 16;
const COL_W = W / STAGES.length;
const LABEL_Y = 248;
const VALUE_Y = 276;
const SPLIT_Y = 298;

function nodeHeight(count: number, maxCount: number): number {
  if (count < 0) return NODE_MAX_H; // source reservoir (cost)
  if (count <= 0) return 10;
  if (maxCount <= 1) return NODE_MIN_H;
  const ratio = Math.log10(count + 1) / Math.log10(maxCount + 1);
  return NODE_MIN_H + ratio * (NODE_MAX_H - NODE_MIN_H);
}

function nodeX(i: number): number {
  return i * COL_W + (COL_W - NODE_W) / 2;
}

// Tapering band between two pipe segments (bezier top + bottom edges).
function bandPath(x1: number, h1: number, x2: number, h2: number): string {
  const mx = (x1 + x2) / 2;
  const t1 = CY - h1 / 2;
  const b1 = CY + h1 / 2;
  const t2 = CY - h2 / 2;
  const b2 = CY + h2 / 2;
  return [
    `M ${x1} ${t1}`,
    `C ${mx} ${t1}, ${mx} ${t2}, ${x2} ${t2}`,
    `L ${x2} ${b2}`,
    `C ${mx} ${b2}, ${mx} ${b1}, ${x1} ${b1}`,
    "Z",
  ].join(" ");
}

// ————————————————————————————————————————————————————————————————

function formulaParts(
  key: MetricKeyT,
  c: RawCounts,
): { expression: string; numbers: string } {
  switch (key) {
    case "CPM":
      return {
        expression: "spend ÷ impressões × 1000",
        numbers: `${formatBRL(c.spendCents)} ÷ ${formatInt(c.impressions)} × 1000`,
      };
    case "CTR":
      return {
        expression: "cliques ÷ impressões",
        numbers: `${formatInt(c.clicks)} ÷ ${formatInt(c.impressions)}`,
      };
    case "CPC":
      return {
        expression: "spend ÷ cliques",
        numbers: `${formatBRL(c.spendCents)} ÷ ${formatInt(c.clicks)}`,
      };
    case "BOUNCE_RATE":
      return {
        expression: "1 − sessões engajadas ÷ sessões",
        numbers: `1 − ${formatInt(c.engagedSessions)} ÷ ${formatInt(c.sessions)}`,
      };
    case "SESSION_TO_LEAD":
      return {
        expression: "leads ÷ sessões",
        numbers: `${formatInt(c.leads)} ÷ ${formatInt(c.sessions)}`,
      };
    case "CPL":
      return {
        expression: "spend ÷ leads",
        numbers: `${formatBRL(c.spendCents)} ÷ ${formatInt(c.leads)}`,
      };
    case "AR":
      return {
        expression: "ativos ÷ leads",
        numbers: `${formatInt(c.activated)} ÷ ${formatInt(c.leads)}`,
      };
    case "PCR":
      return {
        expression: "clientes ÷ ativos",
        numbers: `${formatInt(c.customers)} ÷ ${formatInt(c.activated)}`,
      };
    case "CAC":
      return {
        expression: "spend ÷ clientes",
        numbers: `${formatBRL(c.spendCents)} ÷ ${formatInt(c.customers)}`,
      };
  }
}

export interface FunnelDiagramProps {
  counts: RawCounts;
  metaCounts: RawCounts | null; // null when a single channel is selected
  googleCounts: RawCounts | null;
  health: MetricHealth[];
}

export function FunnelDiagram({
  counts,
  metaCounts,
  googleCounts,
  health,
}: FunnelDiagramProps) {
  const t = useTranslations("funnel");
  const tDiag = useTranslations("diagnosis");
  const [selected, setSelected] = useState<MetricKeyT | null>(null);

  const byKey = useMemo(() => new Map(health.map((h) => [h.key, h])), [health]);
  const selectedHealth = selected ? byKey.get(selected) : null;
  const cac = byKey.get("CAC");
  const showSplit = metaCounts != null && googleCounts != null;

  const geometry = useMemo(() => {
    const maxCount = Math.max(...STAGES.map((s) => s.count(counts)), 1);
    const heights = STAGES.map((s) => nodeHeight(s.count(counts), maxCount));
    const bands = EDGE_METRICS.map((keys, i) => {
      const status = byKey.get(keys[0]!)?.status ?? "neutral";
      const h1 = Math.max(heights[i]! - 6, 10);
      const h2 = Math.max(heights[i + 1]! - 6, 10);
      const x1 = nodeX(i) + NODE_W;
      const x2 = nodeX(i + 1);
      return {
        keys,
        path: bandPath(x1, h1, x2, h2),
        midX: (x1 + x2) / 2,
        color: STATUS_COLOR[status],
      };
    });
    return { heights, bands };
  }, [counts, byKey]);

  const chip = (key: MetricKeyT) => {
    const h = byKey.get(key);
    if (!h) return null;
    const classes = HEALTH_CLASSES[h.status];
    return (
      <button
        key={key}
        type="button"
        onClick={() => setSelected(selected === key ? null : key)}
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap tabular-nums transition-colors",
          classes.chip,
          selected === key && "ring-2 ring-ring",
        )}
      >
        {t(`metrics.${key}`)} {formatMetricValue(h.value, h.unit)}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* ——— Desktop: connected pipeline (SVG diagram + HTML gauges) ——— */}
      <div className="hidden md:block rounded-xl border bg-card px-2 pt-1 pb-2">
        <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={t("aria")}
          >
            {/* tapering bands, tinted (quietly) by the health of their conversion */}
            {geometry.bands.map((band, i) => (
              <path key={i} d={band.path} fill={band.color} opacity={0.12} />
            ))}

            {/* pipe segments — source is solid ink, the rest pick up a thin
                desaturated stroke from the conversion feeding them */}
            {STAGES.map((stage, i) => {
              const h = geometry.heights[i]!;
              const x = nodeX(i);
              const isSource = stage.id === "cost";
              const feedColor = i > 0 ? geometry.bands[i - 1]!.color : undefined;
              return (
                <rect
                  key={stage.id}
                  x={x}
                  y={CY - h / 2}
                  width={NODE_W}
                  height={h}
                  rx={9}
                  fill={isSource ? "var(--primary)" : "var(--card)"}
                  stroke={isSource ? "none" : (feedColor ?? "var(--border)")}
                  strokeOpacity={isSource ? 1 : 0.45}
                  strokeWidth={1.25}
                />
              );
            })}

            {/* labels / values / channel split under each column */}
            {STAGES.map((stage, i) => {
              const cx = i * COL_W + COL_W / 2;
              return (
                <g key={stage.id} textAnchor="middle">
                  <text
                    x={cx}
                    y={LABEL_Y}
                    fontSize={11.5}
                    letterSpacing={1.2}
                    fontWeight={600}
                    fill="var(--muted-foreground)"
                  >
                    {t(`stages.${stage.labelKey}`).toUpperCase()}
                  </text>
                  <text x={cx} y={VALUE_Y} fontSize={23} fontWeight={700} fill="var(--foreground)">
                    {stage.prefix ? (
                      <tspan fontSize={12} fill="var(--muted-foreground)">
                        {stage.prefix}{" "}
                      </tspan>
                    ) : null}
                    {stage.value(counts)}
                  </text>
                  {showSplit ? (
                    <text x={cx} y={SPLIT_Y} fontSize={11} fill="var(--muted-foreground)">
                      <tspan fontWeight={700}>M</tspan> {stage.split(metaCounts!)}
                      {"   "}
                      <tspan fontWeight={700}>G</tspan> {stage.split(googleCounts!)}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {/* metric gauges sitting on each pipe — foreignObject so the
                chips scale uniformly with the drawing at any width */}
            {geometry.bands.map((band, i) => (
              <foreignObject
                key={i}
                x={band.midX - 80}
                y={CY - 34}
                width={160}
                height={68}
                className="pointer-events-none overflow-visible"
              >
                <div className="flex h-full flex-col items-center justify-center gap-1 [&>button]:pointer-events-auto">
                  {band.keys.map((key) => chip(key))}
                </div>
              </foreignObject>
            ))}
          </svg>
        </div>
      </div>

      {/* ——— Mobile: vertical funnel ——— */}
      <div className="md:hidden flex flex-col">
        {STAGES.map((stage, i) => (
          <div key={stage.id} className="contents">
            <div className="rounded-xl border bg-card px-4 py-3 flex items-center justify-between gap-3 min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                {t(`stages.${stage.labelKey}`)}
              </p>
              <div className="text-right">
                <p className="text-base font-bold tabular-nums leading-tight truncate">
                  {stage.prefix ? (
                    <span className="text-[10px] font-semibold text-muted-foreground align-middle mr-0.5">
                      {stage.prefix}
                    </span>
                  ) : null}
                  {stage.value(counts)}
                </p>
                {showSplit ? (
                  <p className="text-[10px] text-muted-foreground tabular-nums truncate">
                    <span className="font-semibold">M</span> {stage.split(metaCounts!)}
                    {" · "}
                    <span className="font-semibold">G</span> {stage.split(googleCounts!)}
                  </p>
                ) : null}
              </div>
            </div>
            {i < EDGE_METRICS.length ? (
              <div className="flex items-center justify-center gap-1.5 py-1.5">
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                {EDGE_METRICS[i]!.map((key) => chip(key))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* CAC: the verdict driver gets a full-width strip, not a pipe gauge */}
      {cac ? (
        <button
          type="button"
          onClick={() => setSelected(selected === "CAC" ? null : "CAC")}
          className={cn(
            "w-full rounded-xl border px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left transition-shadow",
            HEALTH_CLASSES[cac.status].border,
            selected === "CAC" && "ring-2 ring-ring",
          )}
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            CAC
          </span>
          <span
            className={cn(
              "text-lg font-bold tabular-nums rounded-md px-1.5",
              HEALTH_CLASSES[cac.status].chip,
            )}
          >
            {formatMetricValue(cac.value, "cents")}
          </span>
          {cac.threshold ? (
            <span className="text-xs text-muted-foreground">
              {t("ceiling")} {formatBRL(cac.threshold.death)}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">{t("cacHint")}</span>
        </button>
      ) : null}

      {selectedHealth ? (
        <DiagnosisPanel health={selectedHealth} counts={counts} t={t} tDiag={tDiag} />
      ) : null}
    </div>
  );
}

function DiagnosisPanel({
  health,
  counts,
  t,
  tDiag,
}: {
  health: MetricHealth;
  counts: RawCounts;
  t: ReturnType<typeof useTranslations<"funnel">>;
  tDiag: ReturnType<typeof useTranslations<"diagnosis">>;
}) {
  const formula = formulaParts(health.key, counts);
  const classes = HEALTH_CLASSES[health.status];

  return (
    <div className={cn("rounded-xl border bg-card p-4 space-y-2", classes.border)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{t(`metrics.${health.key}`)}</span>
        <code className="text-xs text-muted-foreground">
          {formula.expression} = {formula.numbers} ={" "}
          <strong className="text-foreground">
            {formatMetricValue(health.value, health.unit)}
          </strong>
        </code>
      </div>

      {health.threshold ? (
        <p className="text-xs text-muted-foreground">
          {t("thresholdLine", {
            healthy:
              health.unit === "cents"
                ? formatBRL(health.threshold.healthy)
                : formatPct(health.threshold.healthy),
            death:
              health.unit === "cents"
                ? formatBRL(health.threshold.death)
                : formatPct(health.threshold.death),
          })}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t("sampleLine", {
          n: health.sample.n,
          required: health.sample.required,
          basis: t(`sampleBasis.${health.sample.basis}`),
        })}
      </p>

      {health.diagnosisKey ? (
        <p className="text-sm">
          {tDiag(
            health.diagnosisKey,
            (health.diagnosisParams ?? {}) as Record<string, string | number>,
          )}
        </p>
      ) : null}
    </div>
  );
}
