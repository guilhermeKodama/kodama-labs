import { unstable_cache } from "next/cache";
import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import {
  Landmark,
  AlertTriangle,
  Link2,
  DollarSign,
  Users,
  ArrowRight,
} from "lucide-react";
import { StatCard } from "@/components/info-card";
import { InfoNote } from "@/components/info-note";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber, type AppLocale } from "@/lib/utils";

const HUB_REVALIDATE_SECONDS = 300;

interface PoliticianChip {
  id: string;
  name: string;
  ballotName: string | null;
  party: string | null;
  state: string | null;
  position: string;
}

const getElections2026Data = unstable_cache(
  async () => {
    const [
      activeMandates,
      linkAlerts,
      linkGroups,
      donationSum,
      positions,
      topLinks,
      topDonations,
    ] = await Promise.all([
      prisma.politician.count({ where: { active: true } }),
      prisma.alert.count({ where: { type: "POLITICAL_LINK" } }),
      prisma.politicalLink.groupBy({ by: ["politicianId"], _count: true }),
      prisma.campaignDonation.aggregate({ _sum: { amount: true } }),
      prisma.politician.groupBy({
        by: ["position"],
        _count: true,
        orderBy: { _count: { position: "desc" } },
        take: 8,
      }),
      prisma.politicalLink.groupBy({
        by: ["politicianId"],
        _count: true,
        orderBy: { _count: { politicianId: "desc" } },
        take: 6,
      }),
      prisma.campaignDonation.groupBy({
        by: ["politicianId"],
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 6,
      }),
    ]);

    const ids = Array.from(
      new Set([
        ...topLinks.map((t) => t.politicianId),
        ...topDonations.map((t) => t.politicianId),
      ]),
    );
    const politicians: PoliticianChip[] = ids.length
      ? await prisma.politician.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            ballotName: true,
            party: true,
            state: true,
            position: true,
          },
        })
      : [];
    const pmap = new Map(politicians.map((p) => [p.id, p]));

    return {
      activeMandates,
      linkAlerts,
      withLinks: linkGroups.length,
      donationTotal: Number(donationSum._sum.amount ?? 0),
      positions: positions.map((p) => ({
        position: p.position,
        count: p._count,
      })),
      topLinks: topLinks
        .map((t) => ({ p: pmap.get(t.politicianId), count: t._count }))
        .filter((x): x is { p: PoliticianChip; count: number } => Boolean(x.p)),
      topDonations: topDonations
        .map((t) => ({
          p: pmap.get(t.politicianId),
          sum: Number(t._sum.amount ?? 0),
        }))
        .filter((x): x is { p: PoliticianChip; sum: number } => Boolean(x.p)),
    };
  },
  ["elections-2026-hub-v1"],
  { revalidate: HUB_REVALIDATE_SECONDS },
);

export default async function Elections2026Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const appLocale = locale as AppLocale;
  const t = await getTranslations("pages.elections2026");
  const data = await getElections2026Data();

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl md:text-2xl font-bold mb-1">{t("title")}</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        {t("subtitle")}
      </p>

      <InfoNote className="mb-6">{t("tseNote")}</InfoNote>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard
          title={t("stats.activeMandates")}
          value={formatNumber(data.activeMandates, appLocale)}
          icon={<Landmark className="h-4 w-4 text-purple-500" />}
        />
        <StatCard
          title={t("stats.linkAlerts")}
          value={formatNumber(data.linkAlerts, appLocale)}
          icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
          highlight={data.linkAlerts > 0}
        />
        <StatCard
          title={t("stats.withLinks")}
          value={formatNumber(data.withLinks, appLocale)}
          icon={<Link2 className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title={t("stats.donations")}
          value={formatCurrency(data.donationTotal, appLocale)}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Browse by office */}
      <h2 className="text-base font-semibold mb-3">{t("officesTitle")}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {data.positions.map((o) => (
          <Link
            key={o.position}
            href={`/${locale}/politicians?position=${encodeURIComponent(o.position)}`}
            className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors"
          >
            <p className="text-sm font-medium truncate">{o.position}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {formatNumber(o.count, appLocale)}
            </p>
          </Link>
        ))}
      </div>

      {/* Highlights */}
      <h2 className="text-base font-semibold mb-3">{t("highlightsTitle")}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <HighlightCard
          title={t("mostLinks")}
          icon={<Link2 className="h-4 w-4 text-orange-500" />}
          empty={t("empty")}
          items={data.topLinks.map((x) => ({
            p: x.p,
            meta: `${x.count} vínculo(s)`,
          }))}
          locale={locale}
        />
        <HighlightCard
          title={t("topDonations")}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          empty={t("empty")}
          items={data.topDonations.map((x) => ({
            p: x.p,
            meta: formatCurrency(x.sum, appLocale),
          }))}
          locale={locale}
        />
      </div>

      <Link
        href={`/${locale}/politicians`}
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <Users className="h-4 w-4" />
        {t("browseAll")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function HighlightCard({
  title,
  icon,
  items,
  empty,
  locale,
}: {
  title: string;
  icon: React.ReactNode;
  items: { p: PoliticianChip; meta: string }[];
  empty: string;
  locale: string;
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h3>
      </div>
      {items.length === 0 ? (
        <div className="p-6">
          <EmptyState title={empty} className="border-0 bg-transparent p-0" />
        </div>
      ) : (
        <div className="divide-y">
          {items.map(({ p, meta }) => (
            <Link
              key={p.id}
              href={`/${locale}/politicians/${p.id}`}
              className="flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {p.ballotName ?? p.name}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[p.party, p.state].filter(Boolean).join("/")} — {p.position}
                </div>
              </div>
              <span className="flex-shrink-0 text-xs font-medium tabular-nums">
                {meta}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
