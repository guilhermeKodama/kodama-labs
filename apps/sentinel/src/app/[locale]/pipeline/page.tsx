import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [cursors, recentJobs, rawBacklog] = await Promise.all([
    prisma.ingestionCursor.findMany({
      orderBy: { lastFetchedAt: "desc" },
    }),
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    prisma.rawRecord.count({ where: { processedAt: null } }),
  ]);

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Data Pipeline</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">
            Registros Brutos Pendentes
          </p>
          <p className="text-xl font-bold">
            {rawBacklog.toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">
            Fontes de Dados
          </p>
          <p className="text-xl font-bold">{cursors.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">
            Jobs Executados
          </p>
          <p className="text-xl font-bold">{recentJobs.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">
            Cursores de Ingestão
          </h2>
          {cursors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma fonte configurada ainda. Execute o primeiro job de
              ingestão.
            </p>
          ) : (
            <div className="space-y-2">
              {cursors.map((cursor) => (
                <div
                  key={cursor.id}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {cursor.source} — {cursor.endpoint}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {cursor.totalFetched.toLocaleString("pt-BR")} registros
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <StatusBadge status={cursor.status} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {cursor.lastFetchedAt.toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">
            Execuções Recentes
          </h2>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum job executado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{job.jobName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {job.layer}
                      {job.recordsIn != null
                        ? ` | ${job.recordsIn} → ${job.recordsOut}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <StatusBadge status={job.status} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {job.startedAt.toLocaleString("pt-BR")}
                    </p>
                    {job.error && (
                      <p className="text-[11px] text-destructive mt-0.5 truncate max-w-[140px]">
                        {job.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    IDLE: "bg-muted text-muted-foreground",
    RUNNING: "bg-blue-500/20 text-blue-500",
    COMPLETED: "bg-green-500/20 text-green-500",
    FAILED: "bg-red-500/20 text-red-500",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-[11px] font-medium ${styles[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}
