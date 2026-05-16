import { prisma } from "@sentinel/server/lib/prisma";

interface RawBreakdownRow {
  source: string;
  recordType: string;
  pending: bigint;
  processed: bigint;
  errored: bigint;
}

export interface NodeData {
  id: string;
  label: string;
  value: number;
  status: "active" | "idle" | "error";
  lastRunAt: string | null;
  cronIntervalMs: number;
}

export interface OutputData {
  id: string;
  label: string;
  count: number;
}

export interface RawBreakdown {
  source: string;
  recordType: string;
  pending: number;
  processed: number;
  errored: number;
}

export interface NormalizedTable {
  label: string;
  count: number;
}

export interface PipelineState {
  stats: {
    totalRaw: number;
    totalPending: number;
    totalProcessed: number;
    totalErrored: number;
  };
  normalizedTables: NormalizedTable[];
  rawBreakdown: RawBreakdown[];
  flow: {
    sources: NodeData[];
    processors: NodeData[];
    analyzers: NodeData[];
    outputs: OutputData[];
    totalRaw: number;
    totalProcessed: number;
    totalAlerts: number;
  };
}

const PIPELINE_STATE_CACHE_TTL_MS = 10_000;
let pipelineStateCache: { at: number; value: Promise<PipelineState> } | null = null;

export async function getPipelineState(): Promise<PipelineState> {
  const now = Date.now();
  if (pipelineStateCache && now - pipelineStateCache.at < PIPELINE_STATE_CACHE_TTL_MS) {
    return pipelineStateCache.value;
  }
  const value = computePipelineState();
  pipelineStateCache = { at: now, value };
  value.catch(() => {
    if (pipelineStateCache?.value === value) pipelineStateCache = null;
  });
  return value;
}

async function computePipelineState(): Promise<PipelineState> {
  const [recentJobs, rawRows, normalizedCounts] = await Promise.all([
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.$queryRawUnsafe<RawBreakdownRow[]>(`
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

  const rawBreakdown: RawBreakdown[] = rawRows.map((r) => ({
    source: r.source,
    recordType: r.recordType,
    pending: Number(r.pending),
    processed: Number(r.processed),
    errored: Number(r.errored),
  }));

  const totalPending = rawBreakdown.reduce((s, r) => s + r.pending, 0);
  const totalProcessed = rawBreakdown.reduce((s, r) => s + r.processed, 0);
  const totalErrored = rawBreakdown.reduce((s, r) => s + r.errored, 0);
  const totalRaw = totalPending + totalProcessed + totalErrored;

  const normalizedTables: NormalizedTable[] = [
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

  // Build helpers from recent jobs
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

  function jobLastRunAt(name: string): string | null {
    const job = recentJobs.find((j) => j.jobName === name);
    return job?.startedAt?.toISOString() ?? null;
  }

  function cronInterval(jobName: string): number {
    if (jobName.startsWith("ingest-")) return 300_000;
    if (jobName.startsWith("analyze-")) return 300_000;
    return 60_000; // process-* and link-data
  }

  const sourceBreakdownMap = new Map<string, number>();
  for (const row of rawBreakdown) {
    sourceBreakdownMap.set(
      row.source,
      (sourceBreakdownMap.get(row.source) ?? 0) + row.processed + row.pending,
    );
  }

  function node(id: string, label: string, value: number, jobName: string): NodeData {
    return { id, label, value, status: jobStatus(jobName), lastRunAt: jobLastRunAt(jobName), cronIntervalMs: cronInterval(jobName) };
  }

  const sources: NodeData[] = [
    node("src-pncp-lic", "PNCP Licitações", sourceBreakdownMap.get("PNCP") ?? 0, "ingest-pncp"),
    node("src-pncp-ctr", "PNCP Contratos", 0, "ingest-pncp-contratos"),
    node("src-pncp-itens", "PNCP Itens", 0, "ingest-pncp-details"),
    node("src-transp", "Transparência", sourceBreakdownMap.get("TRANSPARENCIA") ?? 0, "ingest-transparencia"),
    node("src-tse-cand", "TSE Candidatos", sourceBreakdownMap.get("TSE") ?? 0, "ingest-politicians"),
    node("src-tse-doac", "TSE Doações", 0, "ingest-donations"),
    node("src-cnpj", "CNPJ", sourceBreakdownMap.get("CNPJ") ?? 0, "ingest-cnpj"),
    node("src-sancoes", "Sanções (CEIS/CNEP)", (sourceBreakdownMap.get("CEIS") ?? 0) + (sourceBreakdownMap.get("CNEP") ?? 0) + (sourceBreakdownMap.get("TCU") ?? 0), "ingest-sanctions"),
    node("src-atas", "Atas de Preço", 0, "ingest-price-references"),
    node("src-camara", "Câmara / Senado", (sourceBreakdownMap.get("CAMARA") ?? 0) + (sourceBreakdownMap.get("SENADO") ?? 0), "ingest-senadores"),
  ];

  const processors: NodeData[] = [
    node("proc-licitacoes", "Licitações", jobRecords("process-procurements"), "process-procurements"),
    node("proc-contratos", "Contratos", jobRecords("process-contracts"), "process-contracts"),
    node("proc-itens", "Itens", jobRecords("process-items"), "process-items"),
    node("proc-entidades", "Entidades", jobRecords("process-entities"), "process-entities"),
    node("proc-politicos", "Políticos", jobRecords("process-politicians"), "process-politicians"),
    node("proc-doacoes", "Doações", jobRecords("process-donations"), "process-donations"),
    node("proc-servidores", "Servidores", jobRecords("process-servidores"), "process-servidores"),
    node("proc-vinculacao", "Vinculação", jobRecords("link-data"), "link-data"),
  ];

  const analyzers: NodeData[] = [
    node("anal-sobrepreco", "Sobrepreço", jobRecords("analyze-overpricing"), "analyze-overpricing"),
    node("anal-shell", "Empresas de Fachada", jobRecords("analyze-shell-companies"), "analyze-shell-companies"),
    node("anal-sancoes", "Sanções", jobRecords("analyze-sanctions"), "analyze-sanctions"),
    node("anal-rede", "Rede Política", jobRecords("analyze-political-links"), "analyze-political-links"),
    node("anal-ai", "Análise IA", jobRecords("analyze-ai"), "analyze-ai"),
    node("anal-network", "Network", jobRecords("analyze-network"), "analyze-network"),
  ];

  const outputs: OutputData[] = [
    { id: "out-licitacoes", label: "Licitações", count: procurementCount },
    { id: "out-contratos", label: "Contratos", count: contractCount },
    { id: "out-entidades", label: "Entidades", count: entityCount },
    { id: "out-politicos", label: "Políticos", count: politicianCount },
    { id: "out-doacoes", label: "Doações", count: donationCount },
    { id: "out-sancoes", label: "Sanções", count: sanctionCount },
    { id: "out-vinculos", label: "Vínculos", count: linkCount },
    { id: "out-alertas", label: "Alertas", count: alertCount },
  ];

  return {
    stats: { totalRaw, totalPending, totalProcessed, totalErrored },
    normalizedTables,
    rawBreakdown,
    flow: {
      sources,
      processors,
      analyzers,
      outputs,
      totalRaw,
      totalProcessed,
      totalAlerts: alertCount,
    },
  };
}
