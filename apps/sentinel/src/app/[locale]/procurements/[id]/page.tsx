import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, FileText, Download } from "lucide-react";

export default async function ProcurementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const procurement = await prisma.procurement.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { itemNumber: "asc" },
        include: {
          bidResults: {
            orderBy: { ranking: "asc" },
          },
        },
      },
      contracts: { include: { entity: { select: { id: true, name: true, cnpj: true } } } },
      alerts: true,
      analyses: { take: 1, orderBy: { createdAt: "desc" } },
      documents: { orderBy: [{ sequencial: "asc" }] },
      _count: { select: { items: true, contracts: true, alerts: true } },
    },
  });

  if (!procurement) return notFound();

  return (
    <div className="max-w-5xl">
      <Link
        href={`/${locale}/procurements`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <h1 className="text-xl font-bold mb-1">{stripHtml(procurement.description)}</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {procurement.orgName} &middot; {formatCnpj(procurement.orgCnpj)}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <InfoCard label="Valor Estimado" value={procurement.estimatedValue ? formatCurrency(procurement.estimatedValue.toString()) : "-"} />
        <InfoCard label="Valor Homologado" value={procurement.approvedValue ? formatCurrency(procurement.approvedValue.toString()) : "-"} />
        <InfoCard label="Itens" value={procurement._count.items.toString()} />
        <InfoCard label="Contratos" value={procurement._count.contracts.toString()} />
      </div>

      <div className="rounded-lg border bg-card p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Detalhes da Licitação</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-6 text-sm">
          <Field label="Modalidade" value={procurement.modality} />
          <Field label="Situação" value={procurement.status} />
          <Field label="Processo" value={procurement.processo} />
          <Field label="Amparo Legal" value={procurement.legalBasis} />
          <Field label="Modo de Disputa" value={procurement.disputeMode} />
          <Field label="Instrumento" value={procurement.instrumentType} />
          <Field label="SRP" value={procurement.isSrp != null ? (procurement.isSrp ? "Sim" : "Não") : null} />
          <Field label="UF / Cidade" value={[procurement.state, procurement.city].filter(Boolean).join(" / ") || null} />
          <Field label="Publicação" value={procurement.publishedAt.toLocaleDateString("pt-BR")} />
          <Field label="Abertura Propostas" value={procurement.proposalOpenDate?.toLocaleDateString("pt-BR") ?? null} />
          <Field label="Encerramento Propostas" value={procurement.proposalCloseDate?.toLocaleDateString("pt-BR") ?? null} />
          <Field label="Orçamento Sigiloso" value={procurement.confidentialBudget ? "Sim" : "Não"} />
        </div>
        {procurement.legalBasisDescription && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-[11px] text-muted-foreground mb-1">Descrição do Amparo Legal</p>
            <p className="text-sm">{procurement.legalBasisDescription}</p>
          </div>
        )}
        <div className="flex gap-4 mt-3 pt-3 border-t">
          {procurement.linkOrigem && (
            <a href={procurement.linkOrigem} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              Sistema de Origem ↗
            </a>
          )}
          {procurement.linkProcesso && (
            <a href={procurement.linkProcesso} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              Processo Eletrônico ↗
            </a>
          )}
        </div>
      </div>

      {procurement.documents.length > 0 && (
        <div className="rounded-lg border bg-card mb-6 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">
              Documentos da Licitação ({procurement.documents.length})
            </h2>
          </div>
          <div className="divide-y">
            {procurement.documents.map((doc) => {
              const sizeMb = doc.sizeBytes / (1024 * 1024);
              const sizeLabel =
                sizeMb >= 1
                  ? `${sizeMb.toFixed(1)} MB`
                  : `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`;
              const downloadable = !!doc.storageKey || !!doc.sourceUrl;
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-3 hover:bg-muted/30"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {doc.documentType} &middot; {sizeLabel}
                      {doc.mimeType && doc.mimeType !== "application/pdf"
                        ? ` · ${doc.mimeType}`
                        : ""}
                    </p>
                  </div>
                  {downloadable ? (
                    <a
                      href={`/api/procurements/${procurement.id}/documents/${doc.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Baixar
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      indisponível
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {procurement.items.length > 0 && (
        <div className="rounded-lg border bg-card mb-6 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">Itens ({procurement.items.length})</h2>
          </div>
          <div className="md:hidden divide-y">
            {procurement.items.map((item) => (
              <div key={item.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      <span className="text-muted-foreground mr-1.5">#{item.itemNumber}</span>
                      {stripHtml(item.description)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{Number(item.quantity).toLocaleString("pt-BR")} {item.unit}</span>
                      {item.materialOrServiceName && (
                        <>
                          <span>·</span>
                          <span>{item.materialOrServiceName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {formatCurrency(item.totalPrice.toString())}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatCurrency(item.unitPrice.toString())}/un
                    </div>
                    {item.situationName && (
                      <span
                        className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${
                          item.situationName === "Homologado"
                            ? "bg-green-500/20 text-green-600"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.situationName}
                      </span>
                    )}
                  </div>
                </div>
                {item.bidResults.length > 0 && (
                  <div className="rounded bg-muted/30 p-2 space-y-1">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      Resultados ({item.bidResults.length})
                    </div>
                    {item.bidResults.map((bid) => (
                      <div key={bid.id} className="flex items-center gap-2 text-[11px]">
                        <span className="w-5 text-center text-muted-foreground font-mono flex-shrink-0">
                          {bid.ranking ?? "-"}º
                        </span>
                        <span className="flex-1 truncate min-w-0">{bid.supplierName}</span>
                        <span className="font-medium tabular-nums flex-shrink-0">
                          {formatCurrency(bid.totalPrice.toString())}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium w-8">#</th>
                  <th className="text-left p-3 font-medium">Descrição</th>
                  <th className="text-left p-3 font-medium">Tipo</th>
                  <th className="text-right p-3 font-medium">Qtd</th>
                  <th className="text-left p-3 font-medium">Unidade</th>
                  <th className="text-right p-3 font-medium">Preço Unit.</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-left p-3 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {procurement.items.map((item) => (
                  <>
                    <tr key={item.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 text-muted-foreground">{item.itemNumber}</td>
                      <td className="p-3">
                        <div className="max-w-[260px] truncate">{stripHtml(item.description)}</div>
                        {(item.catmatCode || item.ncmCode) && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {item.catmatCode && `CATMAT: ${item.catmatCode}`}
                            {item.catmatCode && item.ncmCode && " · "}
                            {item.ncmCode && `NCM: ${item.ncmCode}`}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">{item.materialOrServiceName ?? "-"}</td>
                      <td className="p-3 text-right tabular-nums">{Number(item.quantity).toLocaleString("pt-BR")}</td>
                      <td className="p-3 text-muted-foreground text-xs">{item.unit}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(item.unitPrice.toString())}</td>
                      <td className="p-3 text-right font-medium tabular-nums">{formatCurrency(item.totalPrice.toString())}</td>
                      <td className="p-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded ${
                          item.situationName === "Homologado"
                            ? "bg-green-500/20 text-green-600"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {item.situationName ?? "-"}
                        </span>
                      </td>
                    </tr>
                    {item.bidResults.length > 0 && (
                      <tr key={`${item.id}-bids`} className="border-b bg-muted/20">
                        <td></td>
                        <td colSpan={7} className="p-3">
                          <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                            Resultados ({item.bidResults.length} fornecedor{item.bidResults.length > 1 ? "es" : ""})
                          </div>
                          <div className="space-y-1">
                            {item.bidResults.map((bid) => (
                              <div key={bid.id} className="flex items-center gap-3 text-xs">
                                <span className="w-5 text-center text-muted-foreground font-mono">
                                  {bid.ranking ?? "-"}º
                                </span>
                                <span className="flex-1 truncate min-w-0">{bid.supplierName}</span>
                                <span className="text-muted-foreground hidden sm:inline">{formatCnpj(bid.supplierCnpj)}</span>
                                <span className="font-medium tabular-nums">{formatCurrency(bid.unitPrice.toString())} /un</span>
                                <span className="font-medium tabular-nums">{formatCurrency(bid.totalPrice.toString())}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {procurement.contracts.length > 0 && (
        <div className="rounded-lg border bg-card mb-6 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">Contratos Vinculados ({procurement.contracts.length})</h2>
          </div>
          <div className="md:hidden divide-y">
            {procurement.contracts.map((c) => (
              <Link
                key={c.id}
                href={`/${locale}/contracts/${c.id}`}
                className="flex items-start justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.supplierName}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{formatCnpj(c.supplierCnpj)}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {stripHtml(c.objectDescription ?? c.description ?? "")}
                  </div>
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
                  <th className="text-left p-3 font-medium">Fornecedor</th>
                  <th className="text-left p-3 font-medium">Objeto</th>
                  <th className="text-right p-3 font-medium">Valor</th>
                  <th className="text-left p-3 font-medium">Vigência</th>
                </tr>
              </thead>
              <tbody>
                {procurement.contracts.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/${locale}/contracts/${c.id}`} className="hover:underline font-medium truncate max-w-[180px]">
                          {c.supplierName}
                        </Link>
                        {c.entity && (
                          <Link
                            href={`/${locale}/entities/${c.entity.id}`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors whitespace-nowrap flex-shrink-0"
                          >
                            Ver entidade
                          </Link>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatCnpj(c.supplierCnpj)}</div>
                    </td>
                    <td className="p-3 truncate max-w-[200px]">{stripHtml(c.objectDescription ?? c.description ?? "")}</td>
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

      {procurement.alerts.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden mb-6">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold">Alertas ({procurement.alerts.length})</h2>
          </div>
          <div className="p-4 space-y-2">
            {procurement.alerts.map((alert) => (
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
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {procurement.analyses.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-base font-semibold">Análise IA</h2>
            <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
              procurement.riskScore && procurement.riskScore >= 0.7
                ? "bg-red-500/20 text-red-500"
                : procurement.riskScore && procurement.riskScore >= 0.4
                  ? "bg-yellow-500/20 text-yellow-500"
                  : "bg-green-500/20 text-green-500"
            }`}>
              Risco: {procurement.riskScore ? `${(procurement.riskScore * 100).toFixed(0)}%` : "-"}
            </span>
          </div>
          <div className="p-4">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {procurement.analyses[0]!.response}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
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
