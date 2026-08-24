import Link from "next/link";
import { prisma } from "@/server/lib/prisma";
import { ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutoDiscardedPage() {
  const [autoDiscarded, latestModel] = await Promise.all([
    prisma.job.findMany({
      where: { autoTriagedAt: { not: null } },
      include: { company: { select: { name: true, slug: true } } },
      orderBy: { autoTriagedAt: "desc" },
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
      </div>

      <div className="m-5 flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <ShieldAlert className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-semibold">
            {latestModel ? "Nada foi descartado de verdade ainda" : "Nenhum modelo treinado ainda"}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {latestModel
              ? "O modelo está marcando o que teria descartado. Ligue a auto-triagem quando a concordância te convencer."
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
        {autoDiscarded.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma vaga foi auto-descartada ainda.
          </p>
        ) : (
          autoDiscarded.map((job) => (
            <Link
              key={job.id}
              href={`/vaga/${job.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 hover:bg-secondary/40"
            >
              <span className="w-9 shrink-0 text-center text-base font-bold tabular-nums">
                {job.compatibilityScore ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{job.title}</div>
                <div className="truncate text-xs text-muted-foreground">{job.company.name}</div>
              </div>
              <span className="text-xs text-muted-foreground">Reverter</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
