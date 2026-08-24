import Link from "next/link";
import { prisma } from "@/server/lib/prisma";
import { updateJobStatus } from "@/server/modules/jobs/actions";
import { triggerRescoreAll } from "@/server/modules/ml/actions";
import { TaskProgress } from "@/components/task-progress";
import { ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutoDiscardedPage() {
  const [autoDiscarded, shadowPredicted, latestModel] = await Promise.all([
    prisma.job.findMany({
      where: { autoTriagedAt: { not: null } },
      include: { company: { select: { name: true, slug: true } } },
      orderBy: { autoTriagedAt: "desc" },
    }),
    prisma.job.findMany({
      where: { scoreSource: "MODEL", status: { in: ["RADAR", "TRIAGEM"] }, autoTriagedAt: null },
      include: { company: { select: { name: true, slug: true } } },
      orderBy: { compatibilityScore: "asc" },
    }),
    prisma.scoringModel.findFirst({ orderBy: { version: "desc" } }),
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Descartadas automaticamente</span>
        {latestModel?.shadowMode !== false && (
          <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium">MODO SOMBRA</span>
        )}
        <div className="flex-1" />
        <TaskProgress types={["rescore-all", "score"]} label="Reavaliando fila" />
        <form action={triggerRescoreAll}>
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
            Reavaliar fila atual contra o modelo
          </button>
        </form>
      </div>

      <div className="m-5 flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <ShieldAlert className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-semibold">
            {latestModel
              ? `${autoDiscarded.length} descartada(s) de verdade · ${shadowPredicted.length} em modo sombra agora`
              : "Nenhum modelo treinado ainda"}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {latestModel
              ? latestModel.shadowMode
                ? "Auto-triagem desligada — nada é descartado de fato. A lista de baixo é só o que o modelo teria feito com a fila atual."
                : "Auto-triagem ligada — as vagas abaixo foram descartadas de verdade."
              : "Treine o modelo em /lab depois de triar algumas dezenas de vagas manualmente — ele aprende com suas decisões."}
          </p>
        </div>
        {latestModel && (
          <div className="flex shrink-0 items-center gap-6 text-right">
            <div>
              <div className="text-lg font-bold tabular-nums">{(latestModel.precision * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">PRECISÃO</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums">{latestModel.trainedOnCount}</div>
              <div className="text-[10px] text-muted-foreground">DECISÕES</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-5 pb-5">
        {autoDiscarded.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Descartadas de verdade
            </div>
            <div className="flex flex-col gap-2">
              {autoDiscarded.map((job) => (
                <div key={job.id} className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
                  <span className="w-9 shrink-0 text-center text-base font-bold tabular-nums">
                    {job.compatibilityScore ?? "—"}
                  </span>
                  <Link href={`/vaga/${job.id}`} className="min-w-0 flex-1 hover:underline">
                    <div className="truncate text-sm font-medium">{job.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{job.company.name}</div>
                  </Link>
                  <form action={updateJobStatus.bind(null, job.id, "TRIAGEM", undefined)}>
                    <button type="submit" className="text-xs text-primary hover:underline">
                      Reverter
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          {autoDiscarded.length > 0 && (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Modo sombra — o que o modelo teria descartado
            </div>
          )}
          {shadowPredicted.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {latestModel
                ? "Nenhuma vaga na fila atual bateu o corte de descarte do modelo. Clique em \"Reavaliar fila atual\" depois de treinar um modelo novo."
                : "Nenhuma vaga foi auto-descartada ainda."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {shadowPredicted.map((job) => (
                <Link
                  key={job.id}
                  href={`/vaga/${job.id}`}
                  className="flex items-center gap-4 rounded-lg border border-dashed border-border bg-card px-4 py-3 hover:bg-secondary/40"
                >
                  <span className="w-9 shrink-0 text-center text-base font-bold tabular-nums text-muted-foreground">
                    {job.compatibilityScore ?? "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{job.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{job.company.name}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{job.status === "RADAR" ? "0 - Radar" : "1 - Triagem"}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
