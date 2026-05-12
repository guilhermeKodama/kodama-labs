import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/page-layout";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Building2, FileText, ShieldAlert, Landmark } from "lucide-react";

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const alert = await prisma.alert.findUnique({
    where: { id },
    include: {
      entity: {
        include: {
          shareholders: { take: 10 },
          sanctions: { take: 5 },
          contracts: { take: 10, orderBy: { startDate: "desc" } },
          _count: { select: { contracts: true, sanctions: true } },
        },
      },
      procurement: {
        include: {
          items: { take: 20, orderBy: { itemNumber: "asc" } },
          contracts: {
            take: 10,
            include: { entity: { select: { id: true, name: true, cnpj: true } } },
          },
          _count: { select: { items: true, contracts: true } },
        },
      },
    },
  });

  if (!alert) return notFound();

  const severityColors: Record<string, string> = {
    CRITICAL: "bg-red-500/20 text-red-500 border-red-500/30",
    HIGH: "bg-orange-500/20 text-orange-500 border-orange-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    LOW: "bg-blue-500/20 text-blue-500 border-blue-500/30",
  };

  const typeLabels: Record<string, string> = {
    OVERPRICING: "Sobrepreço",
    SHELL_COMPANY: "Empresa de Fachada",
    SANCTIONED_ENTITY: "Entidade Sancionada",
    SUSPICIOUS_NETWORK: "Rede Suspeita",
    AI_FLAG: "Sinalização IA",
    POLITICAL_LINK: "Vínculo Político",
  };

  const alertData = alert.data as Record<string, unknown> | null;
  const politicianName = alertData?.politicianName as string | undefined;
  const politicianCpf = alertData?.politicianCpf as string | undefined;
  const party = alertData?.party as string | undefined;
  const linkType = alertData?.linkType as string | undefined;

  const politician = politicianCpf
    ? await prisma.politician.findFirst({ where: { cpf: politicianCpf }, select: { id: true } })
    : null;

  return (
    <PageLayout>
      <div className="max-w-5xl">
        <Link
          href={`/${locale}/alerts`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Alertas
        </Link>

        <div className="flex items-start gap-3 mb-5">
          <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${
            alert.severity === "CRITICAL" ? "bg-red-500" :
            alert.severity === "HIGH" ? "bg-orange-500" :
            alert.severity === "MEDIUM" ? "bg-yellow-500" : "bg-blue-500"
          }`} />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">{alert.title}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${severityColors[alert.severity]}`}>
                {alert.severity}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted font-medium">
                {typeLabels[alert.type] ?? alert.type}
              </span>
              <span className="text-xs text-muted-foreground">
                {alert.createdAt.toLocaleDateString("pt-BR")} às {alert.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        {alert.description && (
          <div className="rounded-lg border bg-card p-5 mb-5">
            <h2 className="text-xs font-semibold text-muted-foreground mb-2">Descrição</h2>
            <p className="text-sm leading-relaxed">{alert.description}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          {alert.entity && (
            <Link
              href={`/${locale}/entities/${alert.entity.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              <Building2 className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-sm font-medium">{alert.entity.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatCnpj(alert.entity.cnpj)}</p>
              </div>
            </Link>
          )}
          {alert.procurement && (
            <Link
              href={`/${locale}/procurements/${alert.procurement.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              <FileText className="h-4 w-4 text-purple-500" />
              <div>
                <p className="text-sm font-medium truncate max-w-[280px]">{stripHtml(alert.procurement.description)}</p>
                <p className="text-[11px] text-muted-foreground">{alert.procurement.orgName}</p>
              </div>
            </Link>
          )}
          {alert.type === "POLITICAL_LINK" && politicianName && (
            <Link
              href={politician ? `/${locale}/politicians/${politician.id}` : "#"}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
            >
              <Landmark className="h-4 w-4 text-purple-500" />
              <div>
                <p className="text-sm font-medium">{politicianName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {party ?? ""} — {
                    linkType === "SHAREHOLDER_IS_POLITICIAN" ? "Sócio é Político" :
                    linkType === "SUPPLIER_DONATED" ? "Fornecedor Doou" :
                    linkType === "DONOR_GOT_CONTRACT" ? "Doador Recebeu Contrato" :
                    linkType === "FAMILY_IN_SUPPLIER" ? "Familiar Confirmado em Fornecedor" :
                    linkType === "FAMILY_DONATED" ? "Familiar Confirmado Doou" :
                    linkType === "POLITICIAN_IS_SERVANT" ? "Servidor Público" :
                    linkType === "WEALTH_ANOMALY" ? "Crescimento Patrimonial" :
                    linkType === "DONOR_IS_SHAREHOLDER" ? "Doador é Sócio de Fornecedor" :
                    linkType === "DONATION_TIMING" ? "Proximidade Temporal Doação-Contrato" :
                    linkType === "DONOR_CONCENTRATION" ? "Concentração de Doações" :
                    linkType ?? ""
                  }
                </p>
              </div>
            </Link>
          )}
        </div>

        {alert.entity && (
          <div className="rounded-lg border bg-card mb-5 overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Entidade: {alert.entity.name}
              </h2>
              <Link
                href={`/${locale}/entities/${alert.entity.id}`}
                className="text-xs text-primary hover:underline"
              >
                Ver completo →
              </Link>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">CNPJ</p>
                  <p className="text-sm font-medium">{formatCnpj(alert.entity.cnpj)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Natureza Jurídica</p>
                  <p className="text-sm font-medium">{alert.entity.legalNature ?? "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Capital Social</p>
                  <p className="text-sm font-medium">{alert.entity.capital ? formatCurrency(alert.entity.capital.toString()) : "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Abertura</p>
                  <p className="text-sm font-medium">{alert.entity.openDate?.toLocaleDateString("pt-BR") ?? "-"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">Atividade</p>
                  <p className="text-sm font-medium">{alert.entity.activityDesc ?? "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">UF / Cidade</p>
                  <p className="text-sm font-medium">{[alert.entity.state, alert.entity.city].filter(Boolean).join(" / ") || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Contratos</p>
                  <p className="text-sm font-medium">{alert.entity._count.contracts}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Sanções</p>
                  <p className={`text-sm font-medium ${alert.entity._count.sanctions > 0 ? "text-red-500" : ""}`}>
                    {alert.entity._count.sanctions}
                  </p>
                </div>
              </div>

              {alert.entity.shareholders.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Sócios ({alert.entity.shareholders.length})</p>
                  <div className="space-y-1">
                    {alert.entity.shareholders.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm py-1">
                        <span>{s.name} {s.cpfCnpj && <span className="text-[11px] text-muted-foreground ml-1">({s.cpfCnpj})</span>}</span>
                        <span className="text-[11px] text-muted-foreground">{s.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {alert.entity.sanctions.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] font-semibold text-red-500 mb-2 flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Sanções
                  </p>
                  <div className="space-y-2">
                    {alert.entity.sanctions.map((s) => (
                      <div key={s.id} className="text-sm p-2 rounded bg-red-500/5 border border-red-500/10">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 font-medium">{s.source}</span>
                          <span>{s.sanctionType ?? s.type}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {s.sanctioningOrg} · {s.startDate.toLocaleDateString("pt-BR")}
                          {s.endDate && ` → ${s.endDate.toLocaleDateString("pt-BR")}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {alert.entity.contracts.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Contratos Recentes</p>
                  <div className="space-y-1">
                    {alert.entity.contracts.slice(0, 5).map((c) => (
                      <Link
                        key={c.id}
                        href={`/${locale}/contracts/${c.id}`}
                        className="flex items-center justify-between text-sm py-1.5 hover:bg-muted/50 rounded px-2 -mx-2 transition-colors"
                      >
                        <span className="truncate max-w-[350px]">{stripHtml(c.objectDescription ?? c.description)}</span>
                        <span className="text-xs font-medium tabular-nums ml-3">{formatCurrency(c.value.toString())}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {alert.procurement && (
          <div className="rounded-lg border bg-card mb-5 overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Licitação
              </h2>
              <Link
                href={`/${locale}/procurements/${alert.procurement.id}`}
                className="text-xs text-primary hover:underline"
              >
                Ver completo →
              </Link>
            </div>
            <div className="p-4">
              <p className="font-medium mb-2 text-sm">{stripHtml(alert.procurement.description)}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">Órgão</p>
                  <p className="text-sm font-medium">{alert.procurement.orgName}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Modalidade</p>
                  <p className="text-sm font-medium">{alert.procurement.modality}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Valor Estimado</p>
                  <p className="text-sm font-medium">{alert.procurement.estimatedValue ? formatCurrency(alert.procurement.estimatedValue.toString()) : "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Itens / Contratos</p>
                  <p className="text-sm font-medium">{alert.procurement._count.items} itens · {alert.procurement._count.contracts} contratos</p>
                </div>
              </div>

              {alert.procurement.items.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Itens ({alert.procurement._count.items})</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] text-muted-foreground border-b">
                          <th className="text-left py-2 pr-3">#</th>
                          <th className="text-left py-2 pr-3">Descrição</th>
                          <th className="text-right py-2 pr-3">Qtd</th>
                          <th className="text-right py-2 pr-3">Preço Unit.</th>
                          <th className="text-right py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alert.procurement.items.map((item) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="py-2 pr-3 text-muted-foreground">{item.itemNumber}</td>
                            <td className="py-2 pr-3 truncate max-w-[220px]">{stripHtml(item.description)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{Number(item.quantity).toLocaleString("pt-BR")}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(item.unitPrice.toString())}</td>
                            <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(item.totalPrice.toString())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {alert.procurement.contracts.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Contratos Vinculados ({alert.procurement._count.contracts})</p>
                  <div className="space-y-1">
                    {alert.procurement.contracts.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link href={`/${locale}/contracts/${c.id}`} className="hover:underline truncate max-w-[220px]">
                            {stripHtml(c.objectDescription ?? c.description)}
                          </Link>
                          {c.entity && (
                            <Link
                              href={`/${locale}/entities/${c.entity.id}`}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors whitespace-nowrap flex-shrink-0"
                            >
                              {c.entity.name}
                            </Link>
                          )}
                        </div>
                        <span className="text-xs font-medium tabular-nums ml-3 flex-shrink-0">{formatCurrency(c.value.toString())}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {alert.data && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold">Dados do Alerta</h2>
            </div>
            <div className="p-4">
              <pre className="text-xs bg-muted/50 p-4 rounded overflow-x-auto max-w-full">
                {JSON.stringify(alert.data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
