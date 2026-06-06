import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  FileText,
  ScrollText,
  Activity,
  ShieldAlert,
  Package,
  Landmark,
} from "lucide-react";
import { formatDate, formatNumber, type AppLocale } from "@/lib/utils";

async function getDashboardStats() {
  const [
    procurementCount,
    contractCount,
    entityCount,
    itemCount,
    bidResultCount,
    sanctionCount,
    alertCount,
    criticalAlertCount,
    politicianCount,
    politicalLinkCount,
    recentAlerts,
  ] = await Promise.all([
    prisma.procurement.count(),
    prisma.contract.count(),
    prisma.entity.count(),
    prisma.procurementItem.count(),
    prisma.bidResult.count(),
    prisma.sanction.count(),
    prisma.alert.count({ where: { resolvedAt: null } }),
    prisma.alert.count({
      where: { resolvedAt: null, severity: "CRITICAL" },
    }),
    prisma.politician.count(),
    prisma.politicalLink.count(),
    prisma.alert.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { entity: true },
    }),
  ]);

  return {
    procurementCount,
    contractCount,
    entityCount,
    itemCount,
    bidResultCount,
    sanctionCount,
    alertCount,
    criticalAlertCount,
    politicianCount,
    politicalLinkCount,
    recentAlerts,
  };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("pages.dashboard");
  const tStats = await getTranslations("pages.dashboard.stats");
  const stats = await getDashboardStats();
  const appLocale = locale as AppLocale;

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-6">{t("title")}</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title={tStats("procurements")}
          value={stats.procurementCount}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          locale={appLocale}
        />
        <StatCard
          title={tStats("items")}
          value={stats.itemCount}
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          subtitle={tStats("itemsSubtitle", { count: stats.bidResultCount })}
          locale={appLocale}
        />
        <StatCard
          title={tStats("contracts")}
          value={stats.contractCount}
          icon={<ScrollText className="h-4 w-4 text-muted-foreground" />}
          locale={appLocale}
        />
        <StatCard
          title={tStats("entities")}
          value={stats.entityCount}
          icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
          locale={appLocale}
        />
        <StatCard
          title={tStats("sanctions")}
          value={stats.sanctionCount}
          icon={<ShieldAlert className="h-4 w-4 text-orange-500" />}
          highlight={stats.sanctionCount > 0}
          locale={appLocale}
        />
        <StatCard
          title={tStats("politicians")}
          value={stats.politicianCount}
          icon={<Landmark className="h-4 w-4 text-purple-500" />}
          subtitle={stats.politicalLinkCount > 0 ? tStats("politicianLinksSubtitle", { count: stats.politicalLinkCount }) : undefined}
          locale={appLocale}
        />
        <StatCard
          title={tStats("activeAlerts")}
          value={stats.alertCount}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          highlight={stats.criticalAlertCount > 0}
          subtitle={
            stats.criticalAlertCount > 0
              ? tStats("criticalAlertsSubtitle", { count: stats.criticalAlertCount })
              : undefined
          }
          locale={appLocale}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t("recentAlerts")}
          </h2>
          {stats.recentAlerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("recentAlertsEmpty")}
            </p>
          ) : (
            <div className="space-y-2">
              {stats.recentAlerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={`/${locale}/alerts/${alert.id}`}
                  className="flex items-start gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  <SeverityBadge severity={alert.severity} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {alert.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {alert.description}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {formatDate(alert.createdAt, appLocale)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">{t("pipelineStatusTitle")}</h2>
          <p className="text-muted-foreground text-sm">
            {t.rich("pipelineStatusDescription", {
              link: (chunks) => (
                <a href={`/${locale}/pipeline`} className="text-primary underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </PageLayout>
  );
}

function StatCard({
  title,
  value,
  icon,
  highlight,
  subtitle,
  locale,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
  subtitle?: string;
  locale: AppLocale;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${highlight ? "border-destructive/50" : ""}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        {icon}
      </div>
      <p className="text-xl font-bold">{formatNumber(value, locale)}</p>
      {subtitle && (
        <p className="text-[11px] text-destructive mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-500/20 text-red-500",
    HIGH: "bg-orange-500/20 text-orange-500",
    MEDIUM: "bg-yellow-500/20 text-yellow-500",
    LOW: "bg-blue-500/20 text-blue-500",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-[11px] font-medium ${colors[severity] ?? "bg-muted text-muted-foreground"}`}
    >
      {severity}
    </span>
  );
}
