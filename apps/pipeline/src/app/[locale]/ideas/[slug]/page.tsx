import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { getIdeaFunnel, defaultRange, ideaCacBands } from "@pipeline/server/lib/funnel-data";
import { prisma } from "@pipeline/server/lib/prisma";
import { FORMULAS } from "@/lib/funnel/health";
import {
  evaluateGate,
  isManualGate,
  parseGates,
  type GateItem,
  type GateResult,
} from "@/lib/funnel/gates";
import { formatBRL } from "@/lib/format";
import { FunnelDiagram } from "@/components/funnel/funnel-diagram";
import { GatesCard, type EvaluatedGates } from "@/components/funnel/gates-card";
import { VerdictBadge } from "@/components/health";
import { Badge } from "@/components/ui/badge";
import { FunnelControls } from "./controls";
import { IdeaCharts } from "./charts";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ channel?: string; from?: string; to?: string }>;
}

export default async function IdeaPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("idea");

  const channel =
    sp.channel === "meta" ? ("META" as const) : sp.channel === "google" ? ("GOOGLE" as const) : undefined;

  const funnel = await getIdeaFunnel(slug, {
    channel,
    from: sp.from,
    to: sp.to,
  });
  if (!funnel) notFound();

  const { idea, counts, byChannel, health, verdict, daily, quality, dayN } = funnel;
  const range = defaultRange(idea);

  // Budget pacing — campaign-to-date, independent of the selected range
  const allTimeSpend = await prisma.adSpendDaily.aggregate({
    where: { ideaId: idea.id },
    _sum: { spendCents: true },
  });
  const spentCents = allTimeSpend._sum.spendCents ?? 0;
  const totalDays = idea.budgetWeeks ? idea.budgetWeeks * 7 : 28;

  // Gates evaluated against the full selected period
  const gates = parseGates(idea.gates);
  const evaluated: EvaluatedGates | null = gates
    ? {
        go: gates.go.map((item) => evalItem(item)),
        pivot: gates.pivot.map((item) => evalItem(item)),
        kill: gates.kill.map((item) => evalItem(item)),
      }
    : null;

  function evalItem(item: GateItem): {
    item: GateItem;
    result: GateResult | null;
    current: number | null;
  } {
    if (isManualGate(item)) return { item, result: null, current: null };
    const metricKey = {
      cac: "CAC",
      cpl: "CPL",
      ctr: "CTR",
      bounce: "BOUNCE_RATE",
      session_to_lead: "SESSION_TO_LEAD",
      ar: "AR",
      pcr: "PCR",
    } as const;
    const current = FORMULAS[metricKey[item.metric]](counts);
    return { item, result: evaluateGate(item, counts), current };
  }

  const cacBands = ideaCacBands(idea);
  const cacCeiling =
    cacBands.filter((b) => b.cacMaxCents != null).at(-1)?.cacMaxCents ??
    idea.maxCacCents;

  const { staleAdsHours, staleGa4Hours } = quality;

  const warnings: string[] = [];
  if (
    quality.sessionsToClicksRatio != null &&
    counts.clicks >= 50 &&
    quality.sessionsToClicksRatio < 0.7
  ) {
    warnings.push(
      t("warnings.ga4Undercount", {
        pct: Math.round(quality.sessionsToClicksRatio * 100),
      }),
    );
  }
  if (quality.manualApiOverlapDays > 0) {
    warnings.push(t("warnings.manualOverlap", { days: quality.manualApiOverlapDays }));
  }
  for (const ch of ["META", "GOOGLE"] as const) {
    if (funnel.channelKillBreached[ch]) {
      warnings.push(
        t("warnings.channelKill", {
          channel: ch,
          ceiling: formatBRL(idea.channelKillCacCents),
        }),
      );
    }
  }
  if (staleAdsHours != null && staleAdsHours > 12) {
    warnings.push(t("warnings.staleAds", { hours: staleAdsHours }));
  }
  if (staleGa4Hours != null && staleGa4Hours > 36) {
    warnings.push(t("warnings.staleGa4", { hours: staleGa4Hours }));
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {t("backToPortfolio")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{idea.name}</h1>
          <Badge variant="outline">{t(`status.${idea.status}`)}</Badge>
          <VerdictBadge
            decision={verdict.decision}
            label={t(`verdict.${verdict.decision}`)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {idea.budgetTotalCents
            ? dayN != null
              ? t("pacing", {
                  spent: formatBRL(spentCents),
                  budget: formatBRL(idea.budgetTotalCents),
                  day: dayN,
                  totalDays,
                })
              : t("pacingNoDay", {
                  spent: formatBRL(spentCents),
                  budget: formatBRL(idea.budgetTotalCents),
                })
            : t("spentOnly", { spent: formatBRL(spentCents) })}
        </p>
      </div>

      {warnings.length > 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <FunnelControls defaultFrom={range.from} defaultTo={range.to} />

      <FunnelDiagram
        counts={counts}
        metaCounts={channel ? null : byChannel.META}
        googleCounts={channel ? null : byChannel.GOOGLE}
        health={health}
      />

      <IdeaCharts daily={daily} cacCeilingCents={cacCeiling ?? null} />

      {evaluated ? <GatesCard slug={idea.slug} gates={evaluated} /> : null}
    </div>
  );
}
