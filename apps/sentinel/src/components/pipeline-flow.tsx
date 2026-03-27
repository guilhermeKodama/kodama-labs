"use client";

import { useEffect, useMemo, useState } from "react";

interface NodeData {
  id: string;
  label: string;
  value: number;
  status: "active" | "idle" | "error";
  lastRunAt: string | null;
  cronIntervalMs: number;
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

const NODE_INFO: Record<string, string> = {
  // Ingestão
  "src-pncp-lic": "Ingere licitações do Portal Nacional de Contratações Públicas (PNCP), fonte oficial do governo federal para compras públicas.",
  "src-pncp-ctr": "Ingere contratos firmados a partir das licitações do PNCP, incluindo valores, vigência e fornecedores.",
  "src-pncp-itens": "Ingere itens detalhados de cada licitação do PNCP — descrição, quantidade, valor unitário e referência.",
  "src-transp": "Ingere licitações e contratos do Portal da Transparência, cobrindo dados de órgãos federais.",
  "src-tse-cand": "Ingere dados de candidatos do TSE — histórico eleitoral, partidos, patrimônio declarado e situação.",
  "src-tse-doac": "Ingere doações de campanha registradas no TSE, incluindo doador, valor e candidato beneficiado.",
  "src-cnpj": "Ingere dados cadastrais de empresas da Receita Federal — sócios, atividade econômica e endereço.",
  "src-sancoes": "Ingere listas de sanções: CEIS (empresas impedidas), CNEP (penalidades) e TCU (inabilitados).",
  "src-atas": "Ingere atas de registro de preço para usar como referência na detecção de sobrepreço.",
  "src-camara": "Ingere dados de deputados da Câmara e senadores do Senado Federal.",

  // Processamento
  "proc-licitacoes": "Normaliza dados brutos de licitações em registros estruturados com órgão, modalidade e valor estimado.",
  "proc-contratos": "Normaliza contratos extraindo fornecedor, valor, vigência e vinculação à licitação de origem.",
  "proc-itens": "Normaliza itens licitados com descrição padronizada, unidade de medida e valor unitário.",
  "proc-entidades": "Consolida empresas e órgãos a partir de CNPJs encontrados em licitações, contratos e doações.",
  "proc-politicos": "Unifica dados de políticos de TSE, Câmara e Senado em um perfil consolidado por CPF.",
  "proc-doacoes": "Normaliza doações de campanha vinculando doador (PF/PJ) ao candidato e valor recebido.",
  "proc-servidores": "Processa dados de servidores públicos federais para cruzamento com empresas e políticos.",
  "proc-vinculacao": "Cruza dados entre entidades, políticos e servidores para identificar vínculos entre eles.",

  // Análise
  "anal-sobrepreco": "Compara valores de itens licitados com preços de referência (atas) para detectar sobrepreço.",
  "anal-shell": "Detecta indícios de empresas de fachada analisando capital social, idade, sócios e padrões de contratação.",
  "anal-sancoes": "Verifica se empresas ou pessoas contratadas constam em listas de sanções (CEIS, CNEP, TCU).",
  "anal-rede": "Mapeia conexões entre políticos, doadores e empresas contratadas para identificar conflitos de interesse.",
  "anal-ai": "Análise por inteligência artificial que cruza múltiplos sinais para detectar padrões anômalos complexos.",
  "anal-network": "Constrói grafo de relacionamentos entre entidades para visualização e detecção de redes suspeitas.",

  // Dados normalizados
  "out-licitacoes": "Total de licitações normalizadas no banco de dados, prontas para análise e consulta.",
  "out-contratos": "Total de contratos normalizados com fornecedor, valor e vínculo à licitação de origem.",
  "out-entidades": "Total de empresas e órgãos consolidados com dados cadastrais e histórico de contratação.",
  "out-politicos": "Total de políticos com perfil unificado — dados eleitorais, patrimônio e vínculos empresariais.",
  "out-doacoes": "Total de doações de campanha rastreadas com origem, destino e valor.",
  "out-sancoes": "Total de sanções ativas indexadas para cruzamento automático com contratados.",
  "out-vinculos": "Total de vínculos identificados entre políticos, empresas e servidores públicos.",
  "out-alertas": "Total de alertas gerados pelas análises, cada um indicando uma anomalia para investigação.",
};

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

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeDataMap = useMemo(() => {
    const m = new Map<string, { label: string; status: string; value: string; lastRunAt?: string | null; cronIntervalMs?: number }>();
    for (const s of sources) m.set(s.id, { label: s.label, status: s.status, value: s.value > 0 ? fmtNum(s.value) : "", lastRunAt: s.lastRunAt, cronIntervalMs: s.cronIntervalMs });
    for (const p of processors) m.set(p.id, { label: p.label, status: p.status, value: p.value > 0 ? fmtNum(p.value) : "", lastRunAt: p.lastRunAt, cronIntervalMs: p.cronIntervalMs });
    for (const a of analyzers) m.set(a.id, { label: a.label, status: a.status, value: a.value > 0 ? fmtNum(a.value) : "", lastRunAt: a.lastRunAt, cronIntervalMs: a.cronIntervalMs });
    for (const o of outputs) m.set(o.id, { label: o.label, status: "output", value: fmtNum(o.count) });
    return m;
  }, [sources, processors, analyzers, outputs]);

  const handleSelect = (id: string) => {
    setSelectedNodeId((prev) => (prev === id ? null : id));
  };

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

          {/* Background dismiss area */}
          <rect width={SVG_W} height={svgH} fill="transparent" onClick={() => setSelectedNodeId(null)} />

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
                nodeId={s.id}
                pos={pos}
                label={s.label}
                value={s.value > 0 ? fmtNum(s.value) : ""}
                status={s.status}
                lastRunAt={s.lastRunAt}
                cronIntervalMs={s.cronIntervalMs}
                onSelect={handleSelect}
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
                nodeId={p.id}
                pos={pos}
                label={p.label}
                value={p.value > 0 ? fmtNum(p.value) : ""}
                status={p.status}
                lastRunAt={p.lastRunAt}
                cronIntervalMs={p.cronIntervalMs}
                onSelect={handleSelect}
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
                nodeId={a.id}
                pos={pos}
                label={a.label}
                value={a.value > 0 ? fmtNum(a.value) : ""}
                status={a.status}
                lastRunAt={a.lastRunAt}
                cronIntervalMs={a.cronIntervalMs}
                onSelect={handleSelect}
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
                nodeId={o.id}
                pos={pos}
                label={o.label}
                value={fmtNum(o.count)}
                status="output"
                onSelect={handleSelect}
              />
            );
          })}

          {/* Node info popover */}
          {selectedNodeId && positions.get(selectedNodeId) && (
            <NodePopover
              nodeId={selectedNodeId}
              pos={positions.get(selectedNodeId)!}
              data={nodeDataMap.get(selectedNodeId)!}
              onDismiss={() => setSelectedNodeId(null)}
            />
          )}
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
  nodeId,
  pos,
  label,
  value,
  status,
  lastRunAt,
  cronIntervalMs,
  onSelect,
}: {
  nodeId: string;
  pos: { x: number; y: number; w: number; h: number };
  label: string;
  value: string;
  status: "active" | "idle" | "error" | "output";
  lastRunAt?: string | null;
  cronIntervalMs?: number;
  onSelect: (id: string) => void;
}) {
  const fills: Record<string, { bg: string; border: string; text: string; valueFill: string }> = {
    active: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.5)", text: "fill-foreground", valueFill: "rgba(59,130,246,0.8)" },
    idle: { bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.2)", text: "fill-muted-foreground", valueFill: "rgba(148,163,184,0.6)" },
    error: { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.4)", text: "fill-foreground", valueFill: "rgba(239,68,68,0.8)" },
    output: { bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.35)", text: "fill-foreground", valueFill: "rgba(34,197,94,0.9)" },
  };

  const f = fills[status] ?? fills.idle!;

  const showClock = status !== "active" && status !== "output" && lastRunAt && cronIntervalMs;

  return (
    <g
      className={status === "active" ? "node-active" : ""}
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onSelect(nodeId); }}
    >
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
      {showClock && (
        <ClockIcon
          cx={pos.x + pos.w - (value ? 38 : 12)}
          cy={pos.y + pos.h / 2}
          color={f.valueFill}
          lastRunAt={lastRunAt}
          cronIntervalMs={cronIntervalMs}
        />
      )}
    </g>
  );
}

function NodePopover({
  nodeId,
  pos,
  data,
  onDismiss,
}: {
  nodeId: string;
  pos: { x: number; y: number; w: number; h: number; cx: number; cy: number };
  data: { label: string; status: string; value: string; lastRunAt?: string | null; cronIntervalMs?: number };
  onDismiss: () => void;
}) {
  const description = NODE_INFO[nodeId] ?? "";
  const popW = 230;
  const popH = 110;

  const isRightHalf = pos.cx > SVG_W / 2;
  const popX = isRightHalf ? pos.x - popW - 12 : pos.x + pos.w + 12;
  const popY = Math.max(8, Math.min(pos.cy - popH / 2, 400));

  const statusLabels: Record<string, string> = {
    active: "Executando agora",
    idle: "Ocioso",
    error: "Erro na última execução",
    output: "Dados normalizados",
  };

  const scheduleLabel = data.cronIntervalMs
    ? `A cada ${data.cronIntervalMs >= 300_000 ? "5 min" : "1 min"}`
    : null;

  const lastRunLabel = data.lastRunAt
    ? new Date(data.lastRunAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <g onClick={(e) => e.stopPropagation()}>
      <foreignObject x={popX} y={popY} width={popW} height={popH}>
        <div
          // @ts-expect-error xmlns is valid for foreignObject HTML
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: popW,
            height: popH,
            background: "var(--color-card, #fff)",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--color-foreground, #1e293b)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column" as const,
            gap: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 12 }}>{data.label}</strong>
            <span
              onClick={onDismiss}
              style={{ cursor: "pointer", opacity: 0.5, fontSize: 14, lineHeight: 1 }}
            >
              ×
            </span>
          </div>
          {description && (
            <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.35 }}>
              {description}
            </div>
          )}
          <div style={{ marginTop: "auto", display: "flex", gap: 8, fontSize: 10, opacity: 0.6 }}>
            <span>{statusLabels[data.status] ?? data.status}</span>
            {data.value && <span>· {data.value}</span>}
          </div>
          {(scheduleLabel || lastRunLabel) && (
            <div style={{ display: "flex", gap: 8, fontSize: 10, opacity: 0.6 }}>
              {scheduleLabel && <span>⏱ {scheduleLabel}</span>}
              {lastRunLabel && <span>· Última: {lastRunLabel}</span>}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}

function ClockIcon({ cx, cy, color, lastRunAt, cronIntervalMs }: {
  cx: number;
  cy: number;
  color: string;
  lastRunAt: string;
  cronIntervalMs: number;
}) {
  const r = 4;
  const [tooltip, setTooltip] = useState("");
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    function compute() {
      const nextAt = new Date(lastRunAt).getTime() + cronIntervalMs;
      const diffMs = nextAt - Date.now();

      if (diffMs <= 0) {
        setTooltip("Execução agendada");
        return;
      }

      const totalSec = Math.round(diffMs / 1000);
      if (totalSec < 60) {
        setTooltip(`Próxima execução em ~${totalSec}s`);
        return;
      }

      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      setTooltip(sec === 0
        ? `Próxima execução em ~${min}min`
        : `Próxima execução em ~${min}min ${sec}s`);
    }

    compute();
    const id = setInterval(compute, 5_000);
    return () => clearInterval(id);
  }, [lastRunAt, cronIntervalMs]);

  const tipW = tooltip.length * 5.2 + 16;
  const tipH = 20;
  const tipX = cx - tipW / 2;
  const tipY = cy - r - tipH - 4;

  return (
    <g
      opacity={hovered ? 1 : 0.6}
      style={{ cursor: "default" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <circle cx={cx} cy={cy} r={r + 4} fill="transparent" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="0.8" />
      <line x1={cx} y1={cy} x2={cx} y2={cy - 2.2} stroke={color} strokeWidth="0.8" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={cx + 1.6} y2={cy + 0.4} stroke={color} strokeWidth="0.8" strokeLinecap="round" />

      {hovered && tooltip && (
        <g>
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx={4}
            fill="rgba(15,23,42,0.9)"
          />
          <text
            x={cx}
            y={tipY + tipH / 2 + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize="8"
            fontWeight="500"
          >
            {tooltip}
          </text>
        </g>
      )}
    </g>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}
