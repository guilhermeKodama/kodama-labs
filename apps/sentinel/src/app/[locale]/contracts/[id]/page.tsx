import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/page-layout";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      entity: {
        include: {
          sanctions: true,
          shareholders: true,
        },
      },
      procurement: { select: { id: true, description: true, orgName: true, modality: true } },
      alerts: true,
      documents: { orderBy: [{ sequencial: "asc" }] },
    },
  });

  if (!contract) return notFound();

  const supplierContractCount = contract.entity
    ? await prisma.contract.count({ where: { supplierCnpj: contract.supplierCnpj } })
    : 0;

  return (
    <PageLayout>
      <div className="max-w-5xl">
        <Link
          href={`/${locale}/contracts`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <h1 className="text-xl font-bold mb-1">
          {stripHtml(contract.objectDescription ?? contract.description)}
        </h1>
        <p className="text-sm text-muted-foreground mb-5">
          Contrato {contract.contractNumber ?? contract.externalId}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <InfoCard label="Valor Inicial" value={contract.initialValue ? formatCurrency(contract.initialValue.toString()) : "-"} />
          <InfoCard label="Valor Global" value={contract.globalValue ? formatCurrency(contract.globalValue.toString()) : formatCurrency(contract.value.toString())} />
          <InfoCard label="Parcelas" value={contract.installmentCount?.toString() ?? "-"} />
          <InfoCard label="Aditivos" value={contract.amendmentCount.toString()} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Detalhes do Contrato</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field label="Tipo" value={contract.contractType} />
              <Field label="Categoria" value={contract.categoryName} />
              <Field label="Processo" value={contract.processo} />
              <Field label="Nº Contrato" value={contract.contractNumber} />
              <Field label="Assinatura" value={contract.signatureDate?.toLocaleDateString("pt-BR") ?? null} />
              <Field label="Publicação" value={contract.publishedAt?.toLocaleDateString("pt-BR") ?? null} />
              <Field label="Início Vigência" value={contract.startDate.toLocaleDateString("pt-BR")} />
              <Field label="Fim Vigência" value={contract.endDate?.toLocaleDateString("pt-BR") ?? "Indeterminado"} />
              <Field label="Receita" value={contract.isRevenue ? "Sim" : "Não"} />
              <Field label="Valor Parcela" value={contract.installmentValue ? formatCurrency(contract.installmentValue.toString()) : null} />
              {contract.accumulatedValue && (
                <Field label="Valor Acumulado" value={formatCurrency(contract.accumulatedValue.toString())} />
              )}
            </div>
            {contract.procurement && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-[11px] text-muted-foreground mb-1">Licitação Vinculada</p>
                <Link href={`/${locale}/procurements/${contract.procurement.id}`} className="text-sm text-primary hover:underline">
                  {stripHtml(contract.procurement.description)} ({contract.procurement.modality})
                </Link>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Órgão Contratante</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field label="Órgão" value={contract.orgName} />
              <Field label="CNPJ" value={contract.orgCnpj ? formatCnpj(contract.orgCnpj) : null} />
              <Field label="Unidade" value={contract.unitName} />
              <Field label="UF / Cidade" value={[contract.unitState, contract.unitCity].filter(Boolean).join(" / ") || null} />
            </div>

            <h2 className="text-base font-semibold mt-5 mb-3">Fornecedor</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">Razão Social</p>
                {contract.entity ? (
                  <Link href={`/${locale}/entities/${contract.entity.id}`} className="font-medium text-primary hover:underline">
                    {contract.supplierName}
                  </Link>
                ) : (
                  <p className="font-medium">{contract.supplierName ?? "-"}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">CNPJ</p>
                {contract.entity ? (
                  <Link href={`/${locale}/entities/${contract.entity.id}`} className="font-medium text-primary hover:underline">
                    {formatCnpj(contract.supplierCnpj)}
                  </Link>
                ) : (
                  <p className="font-medium">{formatCnpj(contract.supplierCnpj)}</p>
                )}
              </div>
              <Field label="Tipo" value={contract.supplierType === "PJ" ? "Pessoa Jurídica" : contract.supplierType === "PF" ? "Pessoa Física" : contract.supplierType} />
              <Field label="País" value={contract.supplierCountry} />
              {contract.entity && (
                <>
                  <Field label="Capital Social" value={contract.entity.capital ? formatCurrency(contract.entity.capital.toString()) : null} />
                  <Field label="Total Contratos" value={supplierContractCount.toString()} />
                </>
              )}
            </div>

            {contract.subcontractorCnpj && (
              <>
                <h3 className="text-sm font-semibold mt-4 mb-2 text-yellow-600">Subcontratado</h3>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <Field label="Nome" value={contract.subcontractorName} />
                  <Field label="CNPJ" value={formatCnpj(contract.subcontractorCnpj)} />
                </div>
              </>
            )}
          </div>
        </div>

        {contract.documents.length > 0 && (
          <div className="rounded-lg border bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold">
                Documentos do Contrato ({contract.documents.length})
              </h2>
            </div>
            <div className="divide-y">
              {contract.documents.map((doc) => {
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
                        href={`/api/contracts/${contract.id}/documents/${doc.id}/download`}
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

        {contract.entity?.sanctions && contract.entity.sanctions.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-red-500/30 bg-red-500/5">
              <h2 className="text-base font-semibold text-red-600">
                Sanções do Fornecedor ({contract.entity.sanctions.length})
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {contract.entity.sanctions.map((s) => (
                <div key={s.id} className="p-3 rounded-md bg-muted/50 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{s.source}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-600">
                      {s.sanctionType ?? s.type}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{s.sanctioningOrg}</p>
                  <p className="text-xs mt-1">
                    {s.startDate.toLocaleDateString("pt-BR")}
                    {s.endDate && ` → ${s.endDate.toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {contract.alerts.length > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold">Alertas ({contract.alerts.length})</h2>
            </div>
            <div className="p-4 space-y-2">
              {contract.alerts.map((alert) => (
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
      </div>
    </PageLayout>
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
