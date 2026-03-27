import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { formatCnpj } from "@/lib/utils";
import Link from "next/link";
import {
  Users,
  Landmark,
  Building2,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

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

  const linkTypeLabels: Record<string, string> = {
    SHAREHOLDER_IS_POLITICIAN: "Sócio é Político",
    SUPPLIER_DONATED: "Fornecedor Doou para Campanha",
    DONOR_GOT_CONTRACT: "Doador Recebeu Contrato",
    FAMILY_IN_SUPPLIER: "Familiar Confirmado em Fornecedor",
    FAMILY_DONATED: "Familiar Confirmado Doou",
    POLITICIAN_IS_SERVANT: "Político é Servidor Público",
    WEALTH_ANOMALY: "Crescimento Patrimonial Anômalo",
    DONOR_IS_SHAREHOLDER: "Doador é Sócio de Fornecedor",
    DONATION_TIMING: "Proximidade Temporal Doação-Contrato",
    DONOR_CONCENTRATION: "Concentração de Doações",
  };

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

  const strengthColor = (s: number) =>
    s >= 0.8
      ? "bg-red-500/20 text-red-500"
      : s >= 0.5
        ? "bg-orange-500/20 text-orange-500"
        : "bg-yellow-500/20 text-yellow-500";

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Rede de Relacionamentos</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label="Políticos"
          value={stats.politicians}
        />
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label="Doações"
          value={stats.donations}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Vínculos Políticos"
          value={stats.politicalLinks}
          highlight
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Sócios Compartilhados"
          value={stats.sharedShareholders}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Alertas Políticos"
          value={stats.politicalAlerts}
          highlight
        />
      </div>

      {/* Political Links by Type */}
      {Array.from(linksByType.entries()).map(([type, links]) => (
        <div
          key={type}
          className={`rounded-lg border mb-6 overflow-hidden ${linkTypeColors[type] ?? ""}`}
        >
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              {linkTypeLabels[type] ?? type}
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
                      {link.politician.elected && " (Eleito)"}
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
                        {link.entity._count.contracts} contratos
                      </p>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Entidade não vinculada
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
          <p className="text-muted-foreground">
            Nenhum vínculo político detectado ainda. Execute o pipeline de
            ingestão de dados políticos para começar a análise.
          </p>
        </div>
      )}

      {/* Shared Shareholders */}
      {sharedShareholders.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden mb-6">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">
              Sócios em Múltiplas Empresas ({sharedShareholders.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Pessoas que são sócias em 2 ou mais empresas fornecedoras do
              governo
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Nome</th>
                  <th className="text-left p-3 font-medium">CPF/CNPJ</th>
                  <th className="text-center p-3 font-medium">Empresas</th>
                </tr>
              </thead>
              <tbody>
                {sharedShareholders.map((sh) => (
                  <tr key={sh.cpf_cnpj} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{sh.name}</td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {sh.cpf_cnpj}
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[11px] font-medium">
                        {sh.entity_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Political Link Alerts */}
      {politicalLinkAlerts.length > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-card overflow-hidden">
          <div className="p-4 border-b border-orange-500/30 bg-orange-500/5">
            <h2 className="text-base font-semibold text-orange-600">
              Alertas de Vínculos Políticos Recentes
            </h2>
          </div>
          <div className="p-4 space-y-2">
            {politicalLinkAlerts.map((alert) => (
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
                      {alert.severity}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {alert.createdAt.toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {alert.description}
                  </p>
                </div>
              </Link>
            ))}
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
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
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
        {value.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}
