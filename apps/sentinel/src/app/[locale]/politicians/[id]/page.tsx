import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DetailTabs } from "@/components/detail-tabs";
import {
  PoliticianScorecard,
  type ScorecardItem,
} from "@/components/politician-scorecard";
import { formatCurrency, type AppLocale } from "@/lib/utils";
import { OverviewSection } from "./components/overview-section";
import { GastosSection } from "./components/gastos-section";
import { AtuacaoSection } from "./components/atuacao-section";
import { LegalSection } from "./components/legal-section";
import { NoticiasSection } from "./components/noticias-section";
import { VinculosSection } from "./components/vinculos-section";

const TABS = [
  { value: "overview", label: "Visão Geral" },
  { value: "gastos", label: "Gastos" },
  { value: "atuacao", label: "Atuação" },
  { value: "legal", label: "Histórico Legal" },
  { value: "noticias", label: "Notícias" },
  { value: "vinculos", label: "Vínculos & Alertas" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default async function PoliticianDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const appLocale = locale as AppLocale;

  const sp = await searchParams;
  const requestedTab = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: TabValue = TABS.some((t) => t.value === requestedTab)
    ? (requestedTab as TabValue)
    : "overview";

  const politician = await prisma.politician.findUnique({ where: { id } });
  if (!politician) return notFound();

  // Cheap aggregates for the always-on scorecard strip.
  const [linkCount, donationAgg, alertCount, legalCount, expenseAgg, scorecardRows] =
    await Promise.all([
      prisma.politicalLink.count({ where: { politicianId: id } }),
      prisma.campaignDonation.aggregate({
        where: { politicianId: id },
        _count: true,
        _sum: { amount: true },
      }),
      prisma.alert.count({
        where: { data: { path: ["politicianCpf"], equals: politician.cpf } },
      }),
      prisma.legalProceeding.count({ where: { politicianId: id } }),
      prisma.parliamentaryExpense.aggregate({
        where: { politicianId: id },
        _sum: { amount: true },
      }),
      prisma.politicianScorecard.findMany({ where: { politicianId: id } }),
    ]);

  const base = `/${locale}/politicians/${id}`;
  const items: ScorecardItem[] = [
    {
      label: "Alertas",
      value: alertCount,
      href: `${base}?tab=vinculos`,
      tone: alertCount > 0 ? "warn" : "muted",
    },
    {
      label: "Vínculos",
      value: linkCount,
      href: `${base}?tab=vinculos`,
      tone: linkCount > 0 ? "warn" : "muted",
    },
    {
      label: "Doações",
      value: formatCurrency(Number(donationAgg._sum.amount ?? 0), appLocale),
      hint: `${donationAgg._count} registro(s)`,
      href: `${base}?tab=gastos`,
    },
    {
      label: "Processos",
      value: legalCount,
      href: `${base}?tab=legal`,
      tone: legalCount > 0 ? "alert" : "muted",
    },
  ];

  // Derived metrics from analyze-scorecards (light up in later milestones).
  const metric = new Map(scorecardRows.map((r) => [r.metric, r]));
  const pct = (m: string) => {
    const v = metric.get(m)?.valueNum;
    return v != null ? `${Math.round(v)}%` : null;
  };
  const govAlignment = pct("gov_alignment");
  if (govAlignment)
    items.push({ label: "Alinhamento gov.", value: govAlignment });
  const attendance = pct("attendance_rate");
  if (attendance) items.push({ label: "Presença", value: attendance });
  const coherence = pct("coherence_stance");
  if (coherence)
    items.push({
      label: "Coerência discurso×ação",
      value: coherence,
      href: `${base}?tab=atuacao`,
    });
  const expenseTotal = Number(expenseAgg._sum.amount ?? 0);
  if (expenseTotal > 0)
    items.push({
      label: "Gasto CEAP",
      value: formatCurrency(expenseTotal, appLocale),
      href: `${base}?tab=gastos`,
    });

  return (
    <div className="max-w-5xl">
      <Link
        href={`/${locale}/politicians`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            {politician.ballotName ?? politician.name}
          </h1>
          {politician.ballotName &&
            politician.name !== politician.ballotName && (
              <p className="text-base text-muted-foreground">
                {politician.name}
              </p>
            )}
          <p className="text-sm text-muted-foreground">
            {politician.party}/{politician.state} — {politician.position}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {politician.active && (
            <span className="px-2.5 py-1 rounded-full bg-green-500/20 text-green-600 text-xs font-medium">
              Ativo
            </span>
          )}
          {politician.elected && !politician.active && (
            <span className="px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-600 text-xs font-medium">
              Eleito
            </span>
          )}
          {linkCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-600 text-xs font-medium">
              {linkCount} vínculo{linkCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <PoliticianScorecard items={items} />

      <DetailTabs tabs={TABS.map((t) => ({ value: t.value, label: t.label }))} />

      {tab === "overview" && (
        <OverviewSection politician={politician} locale={appLocale} />
      )}
      {tab === "gastos" && (
        <GastosSection politicianId={id} locale={appLocale} />
      )}
      {tab === "atuacao" && (
        <AtuacaoSection politicianId={id} locale={appLocale} />
      )}
      {tab === "legal" && <LegalSection politicianId={id} locale={appLocale} />}
      {tab === "noticias" && (
        <NoticiasSection politicianId={id} locale={appLocale} />
      )}
      {tab === "vinculos" && (
        <VinculosSection politician={politician} locale={appLocale} />
      )}
    </div>
  );
}
