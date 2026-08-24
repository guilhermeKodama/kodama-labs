import { prisma } from "@/server/lib/prisma";
import { spTodayStart } from "@/server/lib/timezone";
import { PushSetup } from "@/components/push-setup";
import { MlControls } from "@/components/ml-controls";
import { env } from "@/env";

export const dynamic = "force-dynamic";

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export default async function LabPage() {
  const [runs, sourcesTotal, jobsToday, dupToday, filteredToday, promotedToday, sources, latestModel, costToday, cacheStats] =
    await Promise.all([
      prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
      prisma.job.count(),
      prisma.job.count({ where: { createdAt: { gte: spTodayStart() } } }),
      prisma.rawPosting.count({ where: { decision: "DUPLICATE", lastSeenAt: { gte: spTodayStart() } } }),
      prisma.rawPosting.count({ where: { decision: "FILTERED_OUT", lastSeenAt: { gte: spTodayStart() } } }),
      prisma.rawPosting.count({ where: { decision: "PROMOTED", lastSeenAt: { gte: spTodayStart() } } }),
      prisma.source.findMany({ orderBy: { key: "asc" } }),
      prisma.scoringModel.findFirst({ orderBy: { version: "desc" } }),
      prisma.llmCall.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: spTodayStart() } } }),
      prisma.llmCall.aggregate({
        _sum: { cacheReadInputTokens: true, cacheCreationInputTokens: true, inputTokens: true },
        where: { createdAt: { gte: spTodayStart() } },
      }),
    ]);

  const pendingDecisions = await prisma.triageDecision.count({
    where: latestModel ? { decidedAt: { gt: latestModel.trainedAt } } : {},
  });

  const cacheRead = cacheStats._sum.cacheReadInputTokens ?? 0;
  const totalRead = cacheRead + (cacheStats._sum.inputTokens ?? 0);
  const cacheHitPct = totalRead > 0 ? ((cacheRead / totalRead) * 100).toFixed(0) : "—";

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Lab</span>
        <span className="text-xs text-muted-foreground">
          {sources.filter((s) => s.enabled).length} fontes ativas de {sources.length}
        </span>
      </div>

      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-6 gap-2.5">
          <KpiCard label="Vagas no total" value={sourcesTotal} sub="importadas + descobertas" />
          <KpiCard label="Novas hoje" value={jobsToday} sub="promovidas" />
          <KpiCard label="Promovidas (raw)" value={promotedToday} sub="hoje" />
          <KpiCard label="Duplicadas hoje" value={dupToday} sub="já existiam" />
          <KpiCard label="Filtradas hoje" value={filteredToday} sub="regra dura" />
          <KpiCard label="Custo LLM hoje" value={`US$ ${Number(costToday._sum.costUsd ?? 0).toFixed(2)}`} sub={`cache hit ${cacheHitPct}%`} />
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-sm font-semibold">Histórico de rodadas</span>
            <span className="text-xs text-muted-foreground">últimas {runs.length}</span>
          </div>
          <div className="grid grid-cols-[110px_70px_60px_70px_60px_70px_60px_1fr] gap-2 border-b border-border pb-2 text-[10px] font-medium text-muted-foreground">
            <span>QUANDO</span>
            <span>TIPO</span>
            <span>CAP</span>
            <span>BUSCADAS</span>
            <span>NOVAS</span>
            <span>PROMOV.</span>
            <span>ADIADAS</span>
            <span>ESTADO</span>
          </div>
          {runs.map((run) => (
            <div key={run.id} className="grid grid-cols-[110px_70px_60px_70px_60px_70px_60px_1fr] gap-2 border-b border-border py-2 text-xs">
              <span className="tabular-nums">{run.startedAt.toLocaleString("pt-BR")}</span>
              <span className="text-muted-foreground">{run.runType}</span>
              <span className="tabular-nums">{run.cap}</span>
              <span className="tabular-nums">{run.fetched}</span>
              <span className="tabular-nums">{run.considered}</span>
              <span className="tabular-nums">{run.promoted}</span>
              <span className="tabular-nums">{run.deferred}</span>
              <span className="text-muted-foreground">{run.status}</span>
            </div>
          ))}
          {runs.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma rodada ainda.</p>}
        </div>

        <div className="grid grid-cols-3 gap-5">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold">Notificações push</div>
            {env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? (
              <PushSetup vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
            ) : (
              <p className="text-xs text-muted-foreground">VAPID não configurado no servidor.</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold">Fontes</div>
            <div className="grid grid-cols-[1fr_60px_70px_60px] gap-2 border-b border-border pb-2 text-[10px] font-medium text-muted-foreground">
              <span>FONTE</span>
              <span>TIPO</span>
              <span>RATE</span>
              <span>STATUS</span>
            </div>
            {sources.map((s) => (
              <div key={s.key} className="grid grid-cols-[1fr_60px_70px_60px] items-center gap-2 border-b border-border py-1.5 text-xs">
                <span className="truncate">{s.key}</span>
                <span className="text-muted-foreground">{s.kind}</span>
                <span className="tabular-nums text-muted-foreground">{s.rateLimitMs}ms</span>
                <span className={s.enabled ? "text-primary" : "text-muted-foreground"}>{s.enabled ? "ligada" : "desligada"}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-semibold">Saúde do modelo</span>
              {latestModel && <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px]">v{latestModel.version}</span>}
            </div>
            {latestModel ? (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <div className="text-lg font-bold tabular-nums">{(latestModel.precision * 100).toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground">PRECISÃO</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums">{(latestModel.recall * 100).toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground">COBERTURA</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums">{latestModel.trainedOnCount}</div>
                    <div className="text-[10px] text-muted-foreground">DECISÕES</div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {latestModel.shadowMode
                    ? "Em modo sombra — auto-triagem ainda não está ligada."
                    : "Auto-triagem ativa."}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhum modelo treinado ainda. Triagem manual gera os rótulos necessários.
              </p>
            )}
            <MlControls model={latestModel} pendingDecisions={pendingDecisions} />
          </div>
        </div>
      </div>
    </div>
  );
}
