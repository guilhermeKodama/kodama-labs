"use client";

import type { PipelineState } from "@sentinel/server/modules/pipeline/get-pipeline-state";
import {
  usePipelineStream,
  type ConnectionStatus,
} from "@/hooks/use-pipeline-stream";
import { PipelineFlow } from "@/components/pipeline-flow";

export function PipelineLive({
  initialState,
}: {
  initialState: PipelineState;
}) {
  const { state, status } = usePipelineStream(initialState);
  const { stats, normalizedTables, rawBreakdown, flow } = state;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">Data Pipeline</h1>
        <StatusIndicator status={status} />
      </div>

      {/* Top-level raw record stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Registros Brutos"
          value={stats.totalRaw}
          className="border-muted"
        />
        <StatCard
          label="Pendentes"
          value={stats.totalPending}
          className="border-yellow-500/40"
          accent="text-yellow-500"
        />
        <StatCard
          label="Processados"
          value={stats.totalProcessed}
          className="border-green-500/40"
          accent="text-green-500"
        />
        <StatCard
          label="Erros"
          value={stats.totalErrored}
          className="border-red-500/40"
          accent="text-red-500"
        />
      </div>

      {/* Normalized data counts */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Dados Normalizados</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {normalizedTables.map((t) => (
            <div
              key={t.label}
              className="rounded-md bg-muted/50 px-3 py-2.5"
            >
              <p className="text-[11px] text-muted-foreground mb-0.5">
                {t.label}
              </p>
              <p className="text-lg font-bold tabular-nums">
                {t.count.toLocaleString("pt-BR")}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Processing breakdown by source/type */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">
          Pipeline de Processamento
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b">
                <th className="pb-2 font-medium">Fonte</th>
                <th className="pb-2 font-medium">Tipo</th>
                <th className="pb-2 font-medium text-right">Pendentes</th>
                <th className="pb-2 font-medium text-right">Processados</th>
                <th className="pb-2 font-medium text-right">Erros</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium text-right">Progresso</th>
              </tr>
            </thead>
            <tbody>
              {rawBreakdown.map((row) => {
                const total = row.pending + row.processed + row.errored;
                const pct =
                  total > 0
                    ? Math.round((row.processed / total) * 100)
                    : 100;

                return (
                  <tr
                    key={`${row.source}-${row.recordType}`}
                    className="border-b border-muted/50 last:border-0"
                  >
                    <td className="py-2 font-medium">{row.source}</td>
                    <td className="py-2 text-muted-foreground">
                      {row.recordType}
                    </td>
                    <td className="py-2 text-right">
                      {row.pending > 0 ? (
                        <span className="text-yellow-500">
                          {row.pending.toLocaleString("pt-BR")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-green-500">
                      {row.processed.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 text-right">
                      {row.errored > 0 ? (
                        <span className="text-red-500">
                          {row.errored.toLocaleString("pt-BR")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {total.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground w-8 text-right">
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live pipeline flow diagram */}
      <div className="mt-6">
        <PipelineFlow
          sources={flow.sources}
          processors={flow.processors}
          analyzers={flow.analyzers}
          outputs={flow.outputs}
          totalRaw={flow.totalRaw}
          totalProcessed={flow.totalProcessed}
          totalAlerts={flow.totalAlerts}
        />
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  className = "",
  accent,
}: {
  label: string;
  value: number;
  className?: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ?? ""}`}>
        {value.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<
    ConnectionStatus,
    { color: string; label: string; pulse: boolean }
  > = {
    connected: { color: "bg-green-500", label: "Ao vivo", pulse: true },
    connecting: {
      color: "bg-yellow-500",
      label: "Reconectando...",
      pulse: true,
    },
    disconnected: {
      color: "bg-muted-foreground",
      label: "Desconectado",
      pulse: false,
    },
  };

  const { color, label, pulse } = config[status];

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
          />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${color}`}
        />
      </span>
      {label}
    </div>
  );
}
