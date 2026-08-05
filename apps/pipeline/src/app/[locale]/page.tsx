import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle, Rocket, Trophy, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { prisma } from "@pipeline/server/lib/prisma";
import { getIdeaFunnel } from "@pipeline/server/lib/funnel-data";
import { unassignedSpend } from "@pipeline/server/lib/rollup";
import { formatBRL, formatInt } from "@/lib/format";
import { HealthDot, VerdictBadge } from "@/components/health";
import { Badge } from "@/components/ui/badge";
import type { MetricKeyT } from "@/lib/funnel/types";

const DOT_METRICS: MetricKeyT[] = [
  "CPM",
  "CTR",
  "BOUNCE_RATE",
  "CPL",
  "AR",
  "PCR",
];

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function PortfolioPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portfolio");
  const tIdea = await getTranslations("idea");

  const ideas = await prisma.idea.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: [{ isLive: "desc" }, { createdAt: "asc" }],
  });

  const [funnels, unassigned, parkedLeads] = await Promise.all([
    Promise.all(ideas.map((idea) => getIdeaFunnel(idea.slug, {}))),
    unassignedSpend(),
    prisma.leadInbox.count({ where: { processedAt: null, error: { not: null } } }),
  ]);

  const totals = funnels.reduce(
    (acc, f) => {
      if (!f) return acc;
      acc.spend += f.counts.spendCents;
      acc.leads += f.counts.leads;
      acc.customers += f.counts.customers;
      return acc;
    },
    { spend: 0, leads: 0, customers: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="pb-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Rocket}
          label={t("stats.activeIdeas")}
          value={formatInt(ideas.filter((i) => i.isLive).length)}
        />
        <StatCard icon={Wallet} label={t("stats.totalSpend")} value={formatBRL(totals.spend)} />
        <StatCard icon={Users} label={t("stats.totalLeads")} value={formatInt(totals.leads)} />
        <StatCard icon={Trophy} label={t("stats.totalCustomers")} value={formatInt(totals.customers)} />
      </div>

      {unassigned.totalCents > 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            {t("unassignedSpend", {
              total: formatBRL(unassigned.totalCents),
              campaigns: unassigned.campaigns
                .map((c) => c.campaignName)
                .join(", "),
            })}
          </p>
        </div>
      ) : null}

      {parkedLeads > 0 ? (
        <div className="rounded-lg border border-destructive/35 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {t("parkedLeads", { count: parkedLeads })}{" "}
            <Link href="/ops" className="underline">
              {t("seeOps")}
            </Link>
          </p>
        </div>
      ) : null}

      {ideas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("columns.idea")}</th>
                <th className="px-4 py-2.5 font-medium">{t("columns.status")}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t("columns.spend")}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t("columns.leads")}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t("columns.customers")}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t("columns.cac")}</th>
                <th className="px-4 py-2.5 font-medium">{t("columns.health")}</th>
                <th className="px-4 py-2.5 font-medium">{t("columns.verdict")}</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea, i) => {
                const f = funnels[i];
                if (!f) return null;
                const cac = f.health.find((h) => h.key === "CAC");
                const ceiling =
                  cac?.threshold?.death ?? idea.maxCacCents ?? null;
                return (
                  <tr key={idea.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/ideas/${idea.slug}`} className="font-medium hover:underline">
                        {idea.name}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{idea.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{tIdea(`status.${idea.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatBRL(f.counts.spendCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatInt(f.counts.leads)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatInt(f.counts.customers)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      {cac?.value != null ? formatBRL(Math.round(cac.value)) : "—"}
                      {ceiling != null ? (
                        <span className="text-muted-foreground text-xs">
                          {" "}
                          / ≤ {formatBRL(ceiling)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {DOT_METRICS.map((key) => {
                          const h = f.health.find((x) => x.key === key);
                          return h ? (
                            <HealthDot
                              key={key}
                              status={h.status}
                              title={key}
                            />
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <VerdictBadge
                        decision={f.verdict.decision}
                        label={tIdea(`verdict.${f.verdict.decision}`)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-3">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5 leading-none">{value}</p>
    </div>
  );
}
