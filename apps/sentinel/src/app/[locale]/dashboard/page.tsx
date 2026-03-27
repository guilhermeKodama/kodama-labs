import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
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

  const stats = await getDashboardStats();

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="Licitações"
          value={stats.procurementCount}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Itens de Licitação"
          value={stats.itemCount}
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          subtitle={`${stats.bidResultCount} resultados de lances`}
        />
        <StatCard
          title="Contratos"
          value={stats.contractCount}
          icon={<ScrollText className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Entidades"
          value={stats.entityCount}
          icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Sanções"
          value={stats.sanctionCount}
          icon={<ShieldAlert className="h-4 w-4 text-orange-500" />}
          highlight={stats.sanctionCount > 0}
        />
        <StatCard
          title="Políticos"
          value={stats.politicianCount}
          icon={<Landmark className="h-4 w-4 text-purple-500" />}
          subtitle={stats.politicalLinkCount > 0 ? `${stats.politicalLinkCount} vínculos` : undefined}
        />
        <StatCard
          title="Alertas Ativos"
          value={stats.alertCount}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          highlight={stats.criticalAlertCount > 0}
          subtitle={
            stats.criticalAlertCount > 0
              ? `${stats.criticalAlertCount} críticos`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Alertas Recentes
          </h2>
          {stats.recentAlerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum alerta ainda. Execute o pipeline para começar a análise.
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
                    {alert.createdAt.toLocaleDateString("pt-BR")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">Pipeline Status</h2>
          <p className="text-muted-foreground text-sm">
            Acesse a página{" "}
            <a href={`/${locale}/pipeline`} className="text-primary underline">
              Pipeline
            </a>{" "}
            para monitorar o status da ingestão e processamento de dados.
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
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
  subtitle?: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${highlight ? "border-destructive/50" : ""}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        {icon}
      </div>
      <p className="text-xl font-bold">{value.toLocaleString("pt-BR")}</p>
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
