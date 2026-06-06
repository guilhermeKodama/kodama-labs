import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { formatCnpj, formatDate, formatNumber, type AppLocale } from "@/lib/utils";
import { extractAlertI18n, renderAlertText } from "@/lib/alert-render";
import Link from "next/link";
import {
  Users,
  Landmark,
  Building2,
  ArrowRight,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

const linkTypeColors: Record<string, string> = {
  SHAREHOLDER_IS_POLITICIAN: "border-red-500/30 bg-red-500/5",
  SUPPLIER_DONATED: "border-orange-500/30 bg-orange-500/5",
  DONOR_GOT_CONTRACT: "border-purple-500/30 bg-purple-500/5",
  FAMILY_IN_SUPPLIER: "border-blue-500/30 bg-blue-500/5",
  FAMILY_DONATED: "border-teal-500/30 bg-teal-500/5",
  POLITICIAN_IS_SERVANT: "border-indigo-500/30 bg-indigo-500/5",
  WEALTH_ANOMALY: "border-amber-500/30 bg-amber-500/5",
  DONOR_IS_SHAREHOLDER: "border-pink-500/30 bg-pink-500/5",
  DONATION_TIMING: "border-cyan-500/30 bg-cyan-500/5",
  DONOR_CONCENTRATION: "border-emerald-500/30 bg-emerald-500/5",
};

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const appLocale = locale as AppLocale;
  const t = await getTranslations("pages.network");
  const tStats = await getTranslations("pages.network.stats");
  const tTable = await getTranslations("pages.network.sharedShareholdersTable");
  const tCommon = await getTranslations("common");
  const tCodes = await getTranslations("codes");
  const tTemplates = await getTranslations();

  const renderCode = (group: string, code: string): string => {
    const key = `${group}.${code}`;
    const v = tCodes(key);
    return v === key ? code : v;
  };

  const politicalLinks = await prisma.politicalLink.findMany({
    orderBy: { strength: "desc" },
    take: 100,
    include: {
      politician: {
        select: {
          id: true,
          name: true,
          ballotName: true,
          party: true,
          position: true,
          state: true,
          elected: true,
        },
      },
      entity: {
        select: {
          id: true,
          name: true,
          cnpj: true,
          state: true,
          _count: { select: { contracts: true } },
        },
      },
    },
  });

  const sharedShareholders = await prisma.$queryRaw<
    { cpf_cnpj: string; name: string; entity_count: number }[]
  >`
    SELECT s."cpfCnpj" as cpf_cnpj, s."name", COUNT(DISTINCT s."entityId")::int as entity_count
    FROM shareholders s
    WHERE s."cpfCnpj" IS NOT NULL
    GROUP BY s."cpfCnpj", s."name"
    HAVING COUNT(DISTINCT s."entityId") >= 2
    ORDER BY entity_count DESC
    LIMIT 50
  `;

  const politicalLinkAlerts = await prisma.alert.findMany({
    where: { type: "POLITICAL_LINK" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      entity: { select: { id: true, name: true, cnpj: true } },
    },
  });

  const stats = {
    politicalLinks: politicalLinks.length,
    sharedShareholders: sharedShareholders.length,
    politicalAlerts: politicalLinkAlerts.length,
    politicians: await prisma.politician.count(),
    donations: await prisma.campaignDonation.count(),
  };

  const linksByType = new Map<string, typeof politicalLinks>();
  for (const link of politicalLinks) {
    const existing = linksByType.get(link.linkType) ?? [];
    existing.push(link);
    linksByType.set(link.linkType, existing);
  }

  const strengthColor = (s: number) =>
    s >= 0.8
      ? "bg-red-500/20 text-red-500"
      : s >= 0.5
        ? "bg-orange-500/20 text-orange-500"
        : "bg-yellow-500/20 text-yellow-500";

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
        {tCommon("disclaimer")}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label={tStats("politicians")}
          value={stats.politicians}
          locale={appLocale}
        />
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label={tStats("donations")}
          value={stats.donations}
          locale={appLocale}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label={tStats("politicalLinks")}
          value={stats.politicalLinks}
          locale={appLocale}
          highlight
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label={tStats("sharedShareholders")}
          value={stats.sharedShareholders}
          locale={appLocale}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label={tStats("politicalAlerts")}
          value={stats.politicalAlerts}
          locale={appLocale}
          highlight
        />
      </div>

      {Array.from(linksByType.entries()).map(([type, links]) => (
        <div
          key={type}
          className={`rounded-lg border mb-6 overflow-hidden ${linkTypeColors[type] ?? ""}`}
        >
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              {renderCode("politicalLinkType", type)}
              <span className="text-sm font-normal text-muted-foreground">
                ({links.length})
              </span>
            </h2>
          </div>
          <div className="divide-y">
            {links.map((link) => (
              <div key={link.id} className="p-4 flex items-start gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Landmark className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/${locale}/politicians`}
                      className="text-sm font-medium hover:underline"
                    >
                      {link.politician.ballotName ?? link.politician.name}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {link.politician.party}/{link.politician.state} —{" "}
                      {link.politician.position}
                      {link.politician.elected && ` (${t("elected")})`}
                    </p>
                  </div>
                </div>

                <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${strengthColor(link.strength)}`}
                  >
                    {(link.strength * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {link.entity ? (
                    <div className="min-w-0">
                      <Link
                        href={`/${locale}/entities/${link.entity.id}`}
                        className="text-sm font-medium hover:underline truncate block"
                      >
                        {link.entity.name}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">
                        {formatCnpj(link.entity.cnpj)} — {link.entity.state ?? "?"} —{" "}
                        {t("contractsLabel", { count: link.entity._count.contracts })}
                      </p>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t("entityNotLinked")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {politicalLinks.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center mb-6">
          <Landmark className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">{t("empty")}</p>
        </div>
      )}

      {sharedShareholders.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden mb-6">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">
              {t("sharedShareholdersTitle")} ({sharedShareholders.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sharedShareholdersSubtitle")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">{tTable("name")}</th>
                  <th className="text-left p-3 font-medium">{tTable("cpfCnpj")}</th>
                  <th className="text-center p-3 font-medium">{tTable("entities")}</th>
                  <th className="w-8 p-3" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {sharedShareholders.map((sh) => {
                  const href = `/${locale}/network/shareholders/${encodeURIComponent(sh.cpf_cnpj)}`;
                  return (
                    <tr
                      key={sh.cpf_cnpj}
                      className="border-b hover:bg-muted/30 cursor-pointer group"
                    >
                      <td className="p-0 font-medium">
                        <Link href={href} className="block p-3">
                          {sh.name}
                        </Link>
                      </td>
                      <td className="p-0 text-muted-foreground text-xs">
                        <Link href={href} className="block p-3">
                          {sh.cpf_cnpj}
                        </Link>
                      </td>
                      <td className="p-0 text-center">
                        <Link href={href} className="block p-3">
                          <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[11px] font-medium">
                            {sh.entity_count}
                          </span>
                        </Link>
                      </td>
                      <td className="p-0 text-muted-foreground">
                        <Link
                          href={href}
                          className="flex items-center justify-center p-3"
                          aria-label={sh.name}
                        >
                          <ChevronRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {politicalLinkAlerts.length > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-card overflow-hidden">
          <div className="p-4 border-b border-orange-500/30 bg-orange-500/5">
            <h2 className="text-base font-semibold text-orange-600">
              {t("recentAlerts")}
            </h2>
          </div>
          <div className="p-4 space-y-2">
            {politicalLinkAlerts.map((alert) => {
              const i18n = extractAlertI18n(alert.data);
              const title = renderAlertText(
                alert.title,
                i18n,
                "titleKey",
                (k, p) => tTemplates(k, p),
                (k) => tCodes(k),
                locale,
              );
              const description = renderAlertText(
                alert.description,
                i18n,
                "descriptionKey",
                (k, p) => tTemplates(k, p),
                (k) => tCodes(k),
                locale,
              );
              return (
                <Link
                  key={alert.id}
                  href={`/${locale}/alerts/${alert.id}`}
                  className="flex items-start gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      alert.severity === "CRITICAL"
                        ? "bg-red-500"
                        : alert.severity === "HIGH"
                          ? "bg-orange-500"
                          : alert.severity === "MEDIUM"
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">
                        {renderCode("severity", alert.severity)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(alert.createdAt, appLocale)}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
  locale,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
  locale: AppLocale;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${highlight ? "border-orange-500/30" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
      <p className={`text-lg font-bold ${highlight ? "text-orange-500" : ""}`}>
        {formatNumber(value, locale)}
      </p>
    </div>
  );
}
