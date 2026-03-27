import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { PipelineFlow } from "@/components/pipeline-flow";

interface RawBreakdown {
  source: string;
  recordType: string;
  pending: bigint;
  processed: bigint;
  errored: bigint;
}

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [
    recentJobs,
    rawBreakdown,
    normalizedCounts,
  ] = await Promise.all([
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.$queryRawUnsafe<RawBreakdown[]>(`
      SELECT
        source,
        "recordType",
        COUNT(*) FILTER (WHERE "processedAt" IS NULL AND "processingError" IS NULL)::bigint as pending,
        COUNT(*) FILTER (WHERE "processedAt" IS NOT NULL)::bigint as processed,
        COUNT(*) FILTER (WHERE "processingError" IS NOT NULL)::bigint as errored
      FROM raw_records
      GROUP BY source, "recordType"
      ORDER BY pending DESC, processed DESC
    `),
    Promise.all([
      prisma.politician.count(),
      prisma.procurement.count(),
      prisma.contract.count(),
      prisma.entity.count(),
      prisma.candidateAsset.count(),
      prisma.campaignDonation.count(),
      prisma.sanction.count(),
      prisma.publicServant.count(),
      prisma.politicalLink.count(),
      prisma.alert.count(),
    ]),
  ]);

  const [
    politicianCount,
    procurementCount,
    contractCount,
    entityCount,
    assetCount,
    donationCount,
    sanctionCount,
    servantCount,
    linkCount,
    alertCount,
  ] = normalizedCounts;

  const totalPending = rawBreakdown.reduce((s, r) => s + Number(r.pending), 0);
  const totalProcessed = rawBreakdown.reduce((s, r) => s + Number(r.processed), 0);
  const totalErrored = rawBreakdown.reduce((s, r) => s + Number(r.errored), 0);
  const totalRaw = totalPending + totalProcessed + totalErrored;

  const normalizedTables = [
    { label: "Políticos", count: politicianCount },
    { label: "Licitações", count: procurementCount },
    { label: "Contratos", count: contractCount },
    { label: "Entidades", count: entityCount },
    { label: "Bens de Candidato", count: assetCount },
    { label: "Doações", count: donationCount },
    { label: "Sanções", count: sanctionCount },
    { label: "Servidores", count: servantCount },
    { label: "Vínculos Políticos", count: linkCount },
    { label: "Alertas", count: alertCount },
  ];

  const jobStatusMap = new Map<string, string>();
  for (const job of recentJobs) {
    if (!jobStatusMap.has(job.jobName)) {
      jobStatusMap.set(job.jobName, job.status);
    }
  }

  function jobStatus(name: string): "active" | "idle" | "error" {
    const s = jobStatusMap.get(name);
    if (s === "RUNNING") return "active";
    if (s === "FAILED") return "error";
    return "idle";
  }

  function jobRecords(name: string): number {
    const job = recentJobs.find((j) => j.jobName === name);
    return job?.recordsOut ?? 0;
  }

  const sourceBreakdownMap = new Map<string, number>();
  for (const row of rawBreakdown) {
    const key = row.source;
    sourceBreakdownMap.set(key, (sourceBreakdownMap.get(key) ?? 0) + Number(row.processed) + Number(row.pending));
  }

  const flowSources = [
    { id: "src-pncp-lic", label: "PNCP Licitações", value: sourceBreakdownMap.get("PNCP") ?? 0, status: jobStatus("ingest-pncp") },
    { id: "src-pncp-ctr", label: "PNCP Contratos", value: 0, status: jobStatus("ingest-pncp-contratos") },
    { id: "src-pncp-itens", label: "PNCP Itens", value: 0, status: jobStatus("ingest-pncp-details") },
    { id: "src-transp", label: "Transparência", value: sourceBreakdownMap.get("TRANSPARENCIA") ?? 0, status: jobStatus("ingest-transparencia") },
    { id: "src-tse-cand", label: "TSE Candidatos", value: sourceBreakdownMap.get("TSE") ?? 0, status: jobStatus("ingest-politicians") },
    { id: "src-tse-doac", label: "TSE Doações", value: 0, status: jobStatus("ingest-donations") },
    { id: "src-cnpj", label: "CNPJ", value: sourceBreakdownMap.get("CNPJ") ?? 0, status: jobStatus("ingest-cnpj") },
    { id: "src-sancoes", label: "Sanções (CEIS/CNEP)", value: (sourceBreakdownMap.get("CEIS") ?? 0) + (sourceBreakdownMap.get("CNEP") ?? 0) + (sourceBreakdownMap.get("TCU") ?? 0), status: jobStatus("ingest-sanctions") },
    { id: "src-atas", label: "Atas de Preço", value: 0, status: jobStatus("ingest-price-references") },
    { id: "src-camara", label: "Câmara / Senado", value: (sourceBreakdownMap.get("CAMARA") ?? 0) + (sourceBreakdownMap.get("SENADO") ?? 0), status: jobStatus("ingest-senadores") },
  ] as const;

  const flowProcessors = [
    { id: "proc-licitacoes", label: "Licitações", value: jobRecords("process-procurements"), status: jobStatus("process-procurements") },
    { id: "proc-contratos", label: "Contratos", value: jobRecords("process-contracts"), status: jobStatus("process-contracts") },
    { id: "proc-itens", label: "Itens", value: jobRecords("process-items"), status: jobStatus("process-items") },
    { id: "proc-entidades", label: "Entidades", value: jobRecords("process-entities"), status: jobStatus("process-entities") },
    { id: "proc-politicos", label: "Políticos", value: jobRecords("process-politicians"), status: jobStatus("process-politicians") },
    { id: "proc-doacoes", label: "Doações", value: jobRecords("process-donations"), status: jobStatus("process-donations") },
    { id: "proc-servidores", label: "Servidores", value: jobRecords("process-servidores"), status: jobStatus("process-servidores") },
    { id: "proc-vinculacao", label: "Vinculação", value: jobRecords("link-data"), status: jobStatus("link-data") },
  ] as const;

  const flowAnalyzers = [
    { id: "anal-sobrepreco", label: "Sobrepreço", value: jobRecords("analyze-overpricing"), status: jobStatus("analyze-overpricing") },
    { id: "anal-shell", label: "Empresas de Fachada", value: jobRecords("analyze-shell-companies"), status: jobStatus("analyze-shell-companies") },
    { id: "anal-sancoes", label: "Sanções", value: jobRecords("analyze-sanctions"), status: jobStatus("analyze-sanctions") },
    { id: "anal-rede", label: "Rede Política", value: jobRecords("analyze-political-links"), status: jobStatus("analyze-political-links") },
    { id: "anal-ai", label: "Análise IA", value: jobRecords("analyze-ai"), status: jobStatus("analyze-ai") },
    { id: "anal-network", label: "Network", value: jobRecords("analyze-network"), status: jobStatus("analyze-network") },
  ] as const;

  const flowOutputs = [
    { id: "out-licitacoes", label: "Licitações", count: procurementCount },
    { id: "out-contratos", label: "Contratos", count: contractCount },
    { id: "out-entidades", label: "Entidades", count: entityCount },
    { id: "out-politicos", label: "Políticos", count: politicianCount },
    { id: "out-doacoes", label: "Doações", count: donationCount },
    { id: "out-sancoes", label: "Sanções", count: sanctionCount },
    { id: "out-vinculos", label: "Vínculos", count: linkCount },
    { id: "out-alertas", label: "Alertas", count: alertCount },
  ];

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Data Pipeline</h1>

      {/* Top-level raw record stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Registros Brutos"
          value={totalRaw}
          className="border-muted"
        />
        <StatCard
          label="Pendentes"
          value={totalPending}
          className="border-yellow-500/40"
          accent="text-yellow-500"
        />
        <StatCard
          label="Processados"
          value={totalProcessed}
          className="border-green-500/40"
          accent="text-green-500"
        />
        <StatCard
          label="Erros"
          value={totalErrored}
          className="border-red-500/40"
          accent="text-red-500"
        />
      </div>

      {/* Normalized data counts */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">
          Dados Normalizados
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {normalizedTables.map((t) => (
            <div
              key={t.label}
              className="rounded-md bg-muted/50 px-3 py-2.5"
            >
              <p className="text-[11px] text-muted-foreground mb-0.5">{t.label}</p>
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
                const pending = Number(row.pending);
                const processed = Number(row.processed);
                const errored = Number(row.errored);
                const total = pending + processed + errored;
                const pct = total > 0 ? Math.round((processed / total) * 100) : 100;

                return (
                  <tr
                    key={`${row.source}-${row.recordType}`}
                    className="border-b border-muted/50 last:border-0"
                  >
                    <td className="py-2 font-medium">{row.source}</td>
                    <td className="py-2 text-muted-foreground">{row.recordType}</td>
                    <td className="py-2 text-right">
                      {pending > 0 ? (
                        <span className="text-yellow-500">{pending.toLocaleString("pt-BR")}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-green-500">
                      {processed.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 text-right">
                      {errored > 0 ? (
                        <span className="text-red-500">{errored.toLocaleString("pt-BR")}</span>
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
          sources={[...flowSources]}
          processors={[...flowProcessors]}
          analyzers={[...flowAnalyzers]}
          outputs={flowOutputs}
          totalRaw={totalRaw}
          totalProcessed={totalProcessed}
          totalAlerts={alertCount}
        />
      </div>
    </PageLayout>
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

