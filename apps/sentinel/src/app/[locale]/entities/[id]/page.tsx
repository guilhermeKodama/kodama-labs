import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/page-layout";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Landmark } from "lucide-react";

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const entity = await prisma.entity.findUnique({
    where: { id },
    include: {
      shareholders: { orderBy: { name: "asc" } },
      contracts: {
        orderBy: { startDate: "desc" },
        take: 20,
      },
      sanctions: { orderBy: { startDate: "desc" } },
      alerts: { orderBy: { createdAt: "desc" }, take: 10 },
      politicalLinks: {
        orderBy: { strength: "desc" },
        include: {
          politician: {
            select: { id: true, name: true, ballotName: true, party: true, position: true, state: true },
          },
        },
      },
    },
  });

  if (!entity) return notFound();

  const totalContractValue = entity.contracts.reduce(
    (sum, c) => sum + Number(c.value),
    0
  );

  return (
    <PageLayout>
      <div className="max-w-5xl">
        <Link
          href={`/${locale}/entities`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{entity.name}</h1>
            {entity.tradeName && (
              <p className="text-base text-muted-foreground">{entity.tradeName}</p>
            )}
            <p className="text-sm text-muted-foreground">{formatCnpj(entity.cnpj)}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {entity.isShellCompany && (
              <span className="px-2.5 py-1 rounded-full bg-red-500/20 text-red-500 text-xs font-medium">
                Possível Fachada
              </span>
            )}
            {entity.riskScore != null && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                entity.riskScore >= 0.7
                  ? "bg-red-500/20 text-red-500"
                  : entity.riskScore >= 0.4
                    ? "bg-yellow-500/20 text-yellow-500"
                    : "bg-green-500/20 text-green-500"
              }`}>
                Risco: {(entity.riskScore * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-6">
          <InfoCard label="Capital Social" value={entity.capital ? formatCurrency(entity.capital.toString()) : "-"} />
          <InfoCard label="Contratos" value={entity.contracts.length.toString()} />
          <InfoCard label="Valor Total Contratos" value={formatCurrency(totalContractValue.toString())} />
          <InfoCard label="Sanções" value={entity.sanctions.length.toString()} highlight={entity.sanctions.length > 0} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Dados da Empresa</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field label="Natureza Jurídica" value={entity.legalNature} />
              <Field label="Abertura" value={entity.openDate?.toLocaleDateString("pt-BR") ?? null} />
              <Field label="Atividade Principal" value={entity.activityDesc} />
              <Field label="Código CNAE" value={entity.activityCode} />
              <Field label="UF" value={entity.state} />
              <Field label="Cidade" value={entity.city} />
              <Field label="Funcionários" value={entity.employeeCount?.toString() ?? null} />
              <Field label="Endereço" value={entity.address} />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">
              Sócios ({entity.shareholders.length})
            </h2>
            {entity.shareholders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Dados de sócios não disponíveis.
              </p>
            ) : (
              <div className="space-y-1.5">
                {entity.shareholders.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{s.name}</span>
                      {s.cpfCnpj && (
                        <span className="text-muted-foreground ml-2 text-[11px]">{s.cpfCnpj}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0 ml-2">{s.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {entity.politicalLinks.length > 0 && (
          <div className="rounded-lg border border-purple-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-purple-500/30 bg-purple-500/5">
              <h2 className="text-base font-semibold text-purple-600 flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                Conexões Políticas ({entity.politicalLinks.length})
              </h2>
            </div>
            <div className="divide-y">
              {entity.politicalLinks.map((link) => {
                const linkTypeLabels: Record<string, string> = {
                  SHAREHOLDER_IS_POLITICIAN: "Sócio é Político",
                  SUPPLIER_DONATED: "Fornecedor Doou para Campanha",
                  DONOR_GOT_CONTRACT: "Doador Recebeu Contrato",
                  FAMILY_IN_SUPPLIER: "Familiar Confirmado em Fornecedor",
                  FAMILY_DONATED: "Familiar Confirmado Doou",
                  POLITICIAN_IS_SERVANT: "Político é Servidor",
                  WEALTH_ANOMALY: "Anomalia Patrimonial",
                  DONOR_IS_SHAREHOLDER: "Doador é Sócio de Fornecedor",
                  DONATION_TIMING: "Proximidade Temporal Doação-Contrato",
                  DONOR_CONCENTRATION: "Concentração de Doações",
                };
                const strengthColor = link.strength >= 0.8
                  ? "bg-red-500/20 text-red-500"
                  : link.strength >= 0.5
                    ? "bg-orange-500/20 text-orange-500"
                    : "bg-yellow-500/20 text-yellow-500";

                return (
                  <div key={link.id} className="p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-600 font-medium">
                        {linkTypeLabels[link.linkType] ?? link.linkType}
                      </span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${strengthColor}`}>
                        Força: {(link.strength * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm mb-2">{link.description}</p>
                    <Link
                      href={`/${locale}/politicians/${link.politician.id}`}
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Landmark className="h-3.5 w-3.5" />
                      {link.politician.ballotName ?? link.politician.name} ({link.politician.party}/{link.politician.state} — {link.politician.position})
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {entity.sanctions.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-red-500/30 bg-red-500/5">
              <h2 className="text-base font-semibold text-red-600">
                Sanções ({entity.sanctions.length})
              </h2>
            </div>
            <div className="md:hidden divide-y">
              {entity.sanctions.map((s) => (
                <div key={s.id} className="p-3 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.sanctionType ?? s.type}</div>
                      {s.sanctioningOrg && (
                        <div className="text-xs text-muted-foreground truncate">{s.sanctioningOrg}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {s.startDate.toLocaleDateString("pt-BR")}
                        {s.endDate && ` → ${s.endDate.toLocaleDateString("pt-BR")}`}
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-600 font-medium">
                      {s.source}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Fonte</th>
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Órgão Sancionador</th>
                    <th className="text-left p-3 font-medium">Período</th>
                  </tr>
                </thead>
                <tbody>
                  {entity.sanctions.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-3">
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-600 font-medium">
                          {s.source}
                        </span>
                      </td>
                      <td className="p-3 text-sm">{s.sanctionType ?? s.type}</td>
                      <td className="p-3">
                        <div className="truncate max-w-[180px]">{s.sanctioningOrg ?? "-"}</div>
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                        {s.startDate.toLocaleDateString("pt-BR")}
                        {s.endDate && ` → ${s.endDate.toLocaleDateString("pt-BR")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {entity.alerts.length > 0 && (
          <div className="rounded-lg border border-orange-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-orange-500/30 bg-orange-500/5">
              <h2 className="text-base font-semibold text-orange-600">
                Alertas ({entity.alerts.length})
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {entity.alerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={`/${locale}/alerts/${alert.id}`}
                  className="flex items-start gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    alert.severity === "CRITICAL" ? "bg-red-500" :
                    alert.severity === "HIGH" ? "bg-orange-500" :
                    alert.severity === "MEDIUM" ? "bg-yellow-500" : "bg-blue-500"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">{alert.type}</span>
                      <span className="text-[11px] text-muted-foreground">{alert.createdAt.toLocaleDateString("pt-BR")}</span>
                    </div>
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {entity.contracts.length > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold">Contratos ({entity.contracts.length})</h2>
            </div>
            <div className="md:hidden divide-y">
              {entity.contracts.map((c) => (
                <Link
                  key={c.id}
                  href={`/${locale}/contracts/${c.id}`}
                  className="flex items-start justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {stripHtml(c.objectDescription ?? c.description)}
                    </div>
                    {c.orgName && (
                      <div className="text-xs text-muted-foreground truncate">{c.orgName}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.startDate.toLocaleDateString("pt-BR")}
                      {c.endDate && ` – ${c.endDate.toLocaleDateString("pt-BR")}`}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(c.value.toString())}
                  </div>
                </Link>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Objeto</th>
                    <th className="text-left p-3 font-medium">Órgão</th>
                    <th className="text-right p-3 font-medium">Valor</th>
                    <th className="text-left p-3 font-medium">Vigência</th>
                  </tr>
                </thead>
                <tbody>
                  {entity.contracts.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <Link href={`/${locale}/contracts/${c.id}`} className="hover:underline truncate max-w-[250px] block">
                          {stripHtml(c.objectDescription ?? c.description)}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground truncate max-w-[140px]">{c.orgName ?? "-"}</td>
                      <td className="p-3 text-right font-medium tabular-nums">{formatCurrency(c.value.toString())}</td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                        {c.startDate.toLocaleDateString("pt-BR")}
                        {c.endDate && ` – ${c.endDate.toLocaleDateString("pt-BR")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${highlight ? "border-red-500/30" : ""}`}>
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-red-500" : ""}`}>{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "-"}</p>
    </div>
  );
}
