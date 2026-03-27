"use client";

import { useMemo } from "react";

interface NodeData {
  id: string;
  label: string;
  value: number;
  status: "active" | "idle" | "error";
}

interface OutputData {
  id: string;
  label: string;
  count: number;
}

interface PipelineFlowProps {
  sources: NodeData[];
  processors: NodeData[];
  analyzers: NodeData[];
  outputs: OutputData[];
  totalRaw: number;
  totalProcessed: number;
  totalAlerts: number;
}

interface Edge {
  from: string;
  to: string;
}

const EDGES_SRC_PROC: Edge[] = [
  { from: "src-pncp-lic", to: "proc-licitacoes" },
  { from: "src-pncp-ctr", to: "proc-contratos" },
  { from: "src-pncp-itens", to: "proc-itens" },
  { from: "src-transp", to: "proc-licitacoes" },
  { from: "src-transp", to: "proc-contratos" },
  { from: "src-tse-cand", to: "proc-politicos" },
  { from: "src-tse-doac", to: "proc-doacoes" },
  { from: "src-cnpj", to: "proc-entidades" },
  { from: "src-sancoes", to: "proc-vinculacao" },
  { from: "src-atas", to: "proc-itens" },
  { from: "src-camara", to: "proc-politicos" },
];

const EDGES_PROC_ANAL: Edge[] = [
  { from: "proc-licitacoes", to: "anal-sobrepreco" },
  { from: "proc-licitacoes", to: "anal-ai" },
  { from: "proc-contratos", to: "anal-sancoes" },
  { from: "proc-contratos", to: "anal-shell" },
  { from: "proc-itens", to: "anal-sobrepreco" },
  { from: "proc-entidades", to: "anal-shell" },
  { from: "proc-entidades", to: "anal-sancoes" },
  { from: "proc-politicos", to: "anal-rede" },
  { from: "proc-doacoes", to: "anal-rede" },
  { from: "proc-vinculacao", to: "anal-network" },
];

const EDGES_ANAL_OUT: Edge[] = [
  { from: "anal-sobrepreco", to: "out-alertas" },
  { from: "anal-shell", to: "out-alertas" },
  { from: "anal-sancoes", to: "out-alertas" },
  { from: "anal-rede", to: "out-alertas" },
  { from: "anal-rede", to: "out-vinculos" },
  { from: "anal-ai", to: "out-alertas" },
  { from: "anal-network", to: "out-vinculos" },
];

const COL_X = [100, 340, 570, 810];
const NODE_W = [170, 140, 150, 140];
const NODE_H = 26;
const NODE_RX = 6;
const SVG_W = 1000;
const HEADER_Y = 30;
const AREA_TOP = 55;

function layoutColumn(
  items: { id: string }[],
  colIdx: number,
  totalHeight: number,
): Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }> {
  const map = new Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>();
  const n = items.length;
  const gap = 6;
  const blockH = n * NODE_H + (n - 1) * gap;
  const startY = AREA_TOP + (totalHeight - AREA_TOP - blockH) / 2;
  const x = COL_X[colIdx]! - NODE_W[colIdx]! / 2;
  const w = NODE_W[colIdx]!;

  items.forEach((item, i) => {
    const y = startY + i * (NODE_H + gap);
    map.set(item.id, { x, y, w, h: NODE_H, cx: x + w / 2, cy: y + NODE_H / 2 });
  });
  return map;
}

function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
): string {
  const dx = (x2 - x1) * 0.45;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function PipelineFlow({
  sources,
  processors,
  analyzers,
  outputs,
  totalRaw,
  totalProcessed,
  totalAlerts,
}: PipelineFlowProps) {
  const maxRows = Math.max(sources.length, processors.length, analyzers.length, outputs.length);
  const svgH = AREA_TOP + maxRows * (NODE_H + 6) + 30;

  const positions = useMemo(() => {
    const all = new Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>();
    for (const [k, v] of layoutColumn(sources, 0, svgH)) all.set(k, v);
    for (const [k, v] of layoutColumn(processors, 1, svgH)) all.set(k, v);
    for (const [k, v] of layoutColumn(analyzers, 2, svgH)) all.set(k, v);
    for (const [k, v] of layoutColumn(outputs.map((o) => ({ id: o.id })), 3, svgH)) all.set(k, v);
    return all;
  }, [sources, processors, analyzers, outputs, svgH]);

  const statusMap = useMemo(() => {
    const m = new Map<string, "active" | "idle" | "error">();
    for (const s of sources) m.set(s.id, s.status);
    for (const p of processors) m.set(p.id, p.status);
    for (const a of analyzers) m.set(a.id, a.status);
    return m;
  }, [sources, processors, analyzers]);

  const allEdges = [...EDGES_SRC_PROC, ...EDGES_PROC_ANAL, ...EDGES_ANAL_OUT];

  const hasActiveIngestion = sources.some((s) => s.status === "active");
  const hasActiveProcessing = processors.some((p) => p.status === "active");
  const hasActiveAnalysis = analyzers.some((a) => a.status === "active");

  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold mb-1">Pipeline em Tempo Real</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Fluxo de dados entre as camadas de ingestão, processamento e análise
      </p>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${SVG_W} ${svgH}`}
          width="100%"
          style={{ minWidth: 800, maxHeight: 520 }}
          className="select-none"
        >
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Column headers */}
          <ColumnHeader x={COL_X[0]!} label="Ingestão" sub={fmtNum(totalRaw)} active={hasActiveIngestion} />
          <ColumnHeader x={COL_X[1]!} label="Processamento" sub={fmtNum(totalProcessed)} active={hasActiveProcessing} />
          <ColumnHeader x={COL_X[2]!} label="Análise" sub={`${fmtNum(totalAlerts)} alertas`} active={hasActiveAnalysis} />
          <ColumnHeader x={COL_X[3]!} label="Dados" sub="normalizados" active={false} />

          {/* Edges */}
          {allEdges.map((edge, i) => {
            const fromPos = positions.get(edge.from);
            const toPos = positions.get(edge.to);
            if (!fromPos || !toPos) return null;

            const fromStatus = statusMap.get(edge.from) ?? "idle";
            const toStatus = statusMap.get(edge.to) ?? "idle";
            const active = fromStatus === "active" || toStatus === "active";

            const x1 = fromPos.x + fromPos.w;
            const y1 = fromPos.cy;
            const x2 = toPos.x;
            const y2 = toPos.cy;
            const pathD = bezierPath(x1, y1, x2, y2);
            const pathId = `edge-${i}`;

            return (
              <g key={pathId}>
                <path
                  id={pathId}
                  d={pathD}
                  fill="none"
                  stroke={active ? "rgba(59,130,246,0.35)" : "rgba(148,163,184,0.15)"}
                  strokeWidth={active ? 1.5 : 1}
                />
                {active && (
                  <>
                    <circle r="2.5" fill="#3b82f6" filter="url(#glow)">
                      <animateMotion dur="2.5s" repeatCount="indefinite" begin="0s">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                    <circle r="2" fill="#60a5fa" opacity="0.7">
                      <animateMotion dur="2.5s" repeatCount="indefinite" begin="0.8s">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                    <circle r="1.5" fill="#93c5fd" opacity="0.5">
                      <animateMotion dur="2.5s" repeatCount="indefinite" begin="1.6s">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  </>
                )}
              </g>
            );
          })}

          {/* Source nodes */}
          {sources.map((s) => {
            const pos = positions.get(s.id);
            if (!pos) return null;
            return (
              <GraphNode
                key={s.id}
                pos={pos}
                label={s.label}
                value={s.value > 0 ? fmtNum(s.value) : ""}
                status={s.status}
              />
            );
          })}

          {/* Processor nodes */}
          {processors.map((p) => {
            const pos = positions.get(p.id);
            if (!pos) return null;
            return (
              <GraphNode
                key={p.id}
                pos={pos}
                label={p.label}
                value={p.value > 0 ? fmtNum(p.value) : ""}
                status={p.status}
              />
            );
          })}

          {/* Analyzer nodes */}
          {analyzers.map((a) => {
            const pos = positions.get(a.id);
            if (!pos) return null;
            return (
              <GraphNode
                key={a.id}
                pos={pos}
                label={a.label}
                value={a.value > 0 ? fmtNum(a.value) : ""}
                status={a.status}
              />
            );
          })}

          {/* Output nodes */}
          {outputs.map((o) => {
            const pos = positions.get(o.id);
            if (!pos) return null;
            return (
              <GraphNode
                key={o.id}
                pos={pos}
                label={o.label}
                value={fmtNum(o.count)}
                status="output"
              />
            );
          })}
        </svg>
      </div>

      <style>{`
        @keyframes pulseNode {
          0%, 100% { filter: drop-shadow(0 0 0 rgba(59,130,246,0)); }
          50% { filter: drop-shadow(0 0 4px rgba(59,130,246,0.4)); }
        }
        .node-active { animation: pulseNode 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function ColumnHeader({ x, label, sub, active }: { x: number; label: string; sub: string; active: boolean }) {
  return (
    <g>
      {active && (
        <>
          <circle cx={x - 46} cy={HEADER_Y - 4} r="3.5" fill="#3b82f6" opacity="0.3">
            <animate attributeName="r" values="3.5;7;3.5" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx={x - 46} cy={HEADER_Y - 4} r="3" fill="#3b82f6" />
        </>
      )}
      <text x={x} y={HEADER_Y - 4} textAnchor="middle" className="fill-foreground" fontSize="12" fontWeight="600">
        {label}
      </text>
      <text x={x} y={HEADER_Y + 10} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
        {sub}
      </text>
    </g>
  );
}

function GraphNode({
  pos,
  label,
  value,
  status,
}: {
  pos: { x: number; y: number; w: number; h: number };
  label: string;
  value: string;
  status: "active" | "idle" | "error" | "output";
}) {
  const fills: Record<string, { bg: string; border: string; text: string; valueFill: string }> = {
    active: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.5)", text: "fill-foreground", valueFill: "rgba(59,130,246,0.8)" },
    idle: { bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.2)", text: "fill-muted-foreground", valueFill: "rgba(148,163,184,0.6)" },
    error: { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.4)", text: "fill-foreground", valueFill: "rgba(239,68,68,0.8)" },
    output: { bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.35)", text: "fill-foreground", valueFill: "rgba(34,197,94,0.9)" },
  };

  const f = fills[status] ?? fills.idle!;

  return (
    <g className={status === "active" ? "node-active" : ""}>
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.w}
        height={pos.h}
        rx={NODE_RX}
        fill={f.bg}
        stroke={f.border}
        strokeWidth={status === "active" ? 1.5 : 1}
      />
      <text
        x={pos.x + 8}
        y={pos.y + pos.h / 2 + 1}
        dominantBaseline="middle"
        className={f.text}
        fontSize="9.5"
        fontWeight="500"
      >
        {label}
      </text>
      {value && (
        <text
          x={pos.x + pos.w - 8}
          y={pos.y + pos.h / 2 + 1}
          dominantBaseline="middle"
          textAnchor="end"
          fill={f.valueFill}
          fontSize="8.5"
          fontWeight="600"
          fontFamily="ui-monospace, monospace"
        >
          {value}
        </text>
      )}
    </g>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}
