import { getTranslations, setRequestLocale } from "next-intl/server";

import { prisma } from "@pipeline/server/lib/prisma";
import { env } from "@/env";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CsvImportCard } from "./csv-import-card";
import { ManualSpendForm } from "./manual-spend-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OpsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ops");

  const [jobRuns, parked, ideas] = await Promise.all([
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.leadInbox.findMany({
      where: { processedAt: null, error: { not: null } },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.idea.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
    }),
  ]);

  // Latest run per job name → health summary at a glance
  const latestByJob = new Map<string, (typeof jobRuns)[number]>();
  for (const run of jobRuns) {
    if (!latestByJob.has(run.jobName)) latestByJob.set(run.jobName, run);
  }

  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "https://<pipeline-host>";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("jobs.title")}</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...latestByJob.values()].map((run) => (
            <div
              key={run.jobName}
              className={cn(
                "rounded-lg border bg-card px-3 py-2.5",
                run.status === "FAILED" && "border-destructive/45",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium truncate">{run.jobName}</span>
                <Badge
                  variant={run.status === "FAILED" ? "destructive" : "outline"}
                  className="text-[10px]"
                >
                  {run.status}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {dateFmt.format(run.startedAt)}
                {run.recordsOut != null ? ` · ${run.recordsOut} out` : ""}
              </p>
              {run.error ? (
                <p className="text-[11px] text-destructive mt-1 line-clamp-2">{run.error}</p>
              ) : null}
              {(run.metadata as { skipped?: string } | null)?.skipped ? (
                <p className="text-[11px] text-warning mt-1">
                  {(run.metadata as { skipped: string }).skipped}
                </p>
              ) : null}
            </div>
          ))}
          {latestByJob.size === 0 ? (
            <p className="text-xs text-muted-foreground">{t("jobs.empty")}</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("manual.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("manual.help")}</p>
        <div className="rounded-lg border bg-card p-4">
          <ManualSpendForm ideas={ideas.map((i) => ({ slug: i.slug, name: i.name }))} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("import.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("import.help")}</p>
        <CsvImportCard ideas={ideas.map((i) => ({ slug: i.slug, name: i.name }))} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          {t("inbox.title")} {parked.length > 0 ? `(${parked.length})` : ""}
        </h2>
        <p className="text-xs text-muted-foreground">{t("inbox.help")}</p>
        {parked.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("inbox.empty")}</p>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {parked.map((row) => (
              <details key={row.id} className="px-3 py-2">
                <summary className="cursor-pointer text-xs flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">
                    {row.error?.split(":")[0]}
                  </Badge>
                  <span className="font-medium">{row.slug}</span>
                  <span className="text-muted-foreground">
                    {dateFmt.format(row.receivedAt)}
                  </span>
                </summary>
                <pre className="mt-2 text-[11px] text-muted-foreground overflow-x-auto max-h-40">
                  {JSON.stringify(row.body, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("config.title")}</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {ideas.map((idea) => (
            <div key={idea.id} className="rounded-lg border bg-card p-4 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{idea.name}</span>
                <Badge variant="outline">{idea.status}</Badge>
              </div>
              <ConfigRow label="Webhook" value={`${appUrl}/api/webhook/lead/${idea.slug}`} mono />
              <ConfigRow label="GA4 property" value={idea.ga4PropertyId ?? t("config.missing")} />
              <ConfigRow label="Meta account" value={idea.metaAdAccountId ?? t("config.missing")} />
              <ConfigRow
                label="Google"
                value={
                  idea.googleCustomerId
                    ? `${idea.googleCustomerId} · prefix "${idea.googleCampaignPrefix}"`
                    : t("config.missing")
                }
              />
              <ConfigRow
                label={t("config.syncedAt")}
                value={idea.syncedAt ? dateFmt.format(idea.syncedAt) : "—"}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className={mono ? "font-mono break-all select-all" : ""}>{value}</span>
    </p>
  );
}
