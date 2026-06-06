import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/page-layout";
import { formatCurrency, formatCnpj } from "@/lib/utils";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  DollarSign,
  AlertTriangle,
} from "lucide-react";

export default async function PoliticianDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const politician = await prisma.politician.findUnique({
    where: { id },
    include: {
      donations: {
        orderBy: [{ amount: "desc" }],
      },
      links: {
        orderBy: { strength: "desc" },
        include: {
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
      },
      assets: {
        orderBy: [{ electionYear: "desc" }, { value: "desc" }],
      },
      servants: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!politician) return notFound();

  const totalDonations = politician.donations.reduce(
    (sum, d) => sum + Number(d.amount),
    0,
  );

  const pjDonations = politician.donations.filter((d) => d.donorType === "PJ");
  const totalPjDonations = pjDonations.reduce(
    (sum, d) => sum + Number(d.amount),
    0,
  );

  const relatedAlerts = await prisma.alert.findMany({
    where: {
      type: "POLITICAL_LINK",
      data: {
        path: ["politicianCpf"],
        equals: politician.cpf,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

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

  const strengthColor = (s: number) =>
    s >= 0.8
      ? "bg-red-500/20 text-red-500"
      : s >= 0.5
        ? "bg-orange-500/20 text-orange-500"
        : "bg-yellow-500/20 text-yellow-500";

  return (
    <PageLayout>
      <div className="max-w-5xl">
        <Link
          href={`/${locale}/politicians`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <div className="flex items-start justify-between gap-3 mb-1">
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
            {politician.links.length > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-600 text-xs font-medium">
                {politician.links.length} vínculo
                {politician.links.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-6">
          <InfoCard label="Partido" value={politician.party ?? "-"} />
          <InfoCard label="Cargo" value={politician.position} />
          <InfoCard
            label="Última Eleição"
            value={politician.electionYear?.toString() ?? "-"}
          />
          <InfoCard
            label="Total Doações PJ"
            value={formatCurrency(totalPjDonations.toString())}
            highlight={totalPjDonations > 50000}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Dados do Político</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field label="Nome Civil" value={politician.name} />
              <Field label="Nome Urna" value={politician.ballotName} />
              <Field label="Partido" value={politician.party} />
              <Field label="Cargo" value={politician.position} />
              <Field label="UF" value={politician.state} />
              <Field label="Cidade" value={politician.city} />
              <Field
                label="Eleição"
                value={politician.electionYear?.toString() ?? null}
              />
              <Field
                label="Eleito"
                value={politician.elected ? "Sim" : "Não"}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Dados Pessoais</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field label="Nascimento" value={politician.birthDate?.toLocaleDateString("pt-BR") ?? null} />
              <Field label="UF Nascimento" value={politician.birthState} />
              <Field label="Cidade Nascimento" value={politician.birthCity} />
              <Field label="Gênero" value={politician.gender} />
              <Field label="Escolaridade" value={politician.education} />
              <Field label="Estado Civil" value={politician.maritalStatus} />
              <Field label="Ocupação" value={politician.occupation} />
              <Field label="Email" value={politician.email} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">Resumo Financeiro</h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <Field
                label="Total de Doações"
                value={formatCurrency(totalDonations.toString())}
              />
              <Field
                label="Doações de Empresas (PJ)"
                value={formatCurrency(totalPjDonations.toString())}
              />
              <Field
                label="Nº de Doações"
                value={politician.donations.length.toString()}
              />
              <Field
                label="Doações PJ"
                value={pjDonations.length.toString()}
              />
            </div>
          </div>

          {politician.servants.length > 0 && (
            <div className="rounded-lg border border-purple-500/30 bg-card p-5">
              <h2 className="text-base font-semibold mb-3 text-purple-600">Vínculo como Servidor Público</h2>
              <div className="space-y-3">
                {politician.servants.map((s) => (
                  <div key={s.id} className="text-sm grid grid-cols-2 gap-y-2 gap-x-4">
                    <Field label="Cargo" value={s.cargo} />
                    <Field label="Função" value={s.funcao} />
                    <Field label="Órgão" value={s.orgao} />
                    <Field label="Situação" value={s.situacao} />
                    <Field label="Remuneração" value={s.remuneracao ? formatCurrency(s.remuneracao.toString()) : null} />
                    <Field label="Admissão" value={s.dataAdmissao?.toLocaleDateString("pt-BR") ?? null} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* All Donations — detailed table */}
        {politician.donations.length > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden mb-6">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Todas as Doações ({politician.donations.length})
              </h2>
            </div>
            <div className="md:hidden divide-y">
              {politician.donations.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{d.donorName}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {d.donorCpfCnpj.length === 14
                        ? formatCnpj(d.donorCpfCnpj)
                        : d.donorCpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{d.electionYear}</span>
                      {(d.donorState || d.state) && (
                        <>
                          <span>·</span>
                          <span>{d.donorState ?? d.state}</span>
                        </>
                      )}
                      {d.donorType && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            d.donorType === "PJ"
                              ? "bg-blue-500/20 text-blue-600"
                              : "bg-green-500/20 text-green-600"
                          }`}
                        >
                          {d.donorType}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(d.amount.toString())}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Doador</th>
                    <th className="text-left p-3 font-medium">CPF/CNPJ</th>
                    <th className="text-center p-3 font-medium">Tipo</th>
                    <th className="text-right p-3 font-medium">Valor</th>
                    <th className="text-left p-3 font-medium">Origem</th>
                    <th className="text-left p-3 font-medium">Espécie</th>
                    <th className="text-left p-3 font-medium">Atividade (CNAE)</th>
                    <th className="text-center p-3 font-medium">UF Doador</th>
                    <th className="text-center p-3 font-medium">Data</th>
                    <th className="text-center p-3 font-medium">Ano</th>
                  </tr>
                </thead>
                <tbody>
                  {politician.donations.map((d) => (
                    <tr key={d.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-3 max-w-[200px]">
                        <div className="font-medium truncate">{d.donorName}</div>
                        {d.donorNameRfb && d.donorNameRfb !== d.donorName && (
                          <div className="text-[10px] text-muted-foreground truncate">RFB: {d.donorNameRfb}</div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs font-mono">
                        {d.donorCpfCnpj.length === 14
                          ? formatCnpj(d.donorCpfCnpj)
                          : d.donorCpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          d.donorType === "PJ"
                            ? "bg-blue-500/20 text-blue-600"
                            : d.donorType === "PF"
                              ? "bg-green-500/20 text-green-600"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {d.donorType ?? "-"}
                        </span>
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {formatCurrency(d.amount.toString())}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground truncate max-w-[150px]">
                        {d.originType ?? "-"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground truncate max-w-[100px]">
                        {d.speciesType ?? "-"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground truncate max-w-[150px]">
                        {d.donorCnae ?? "-"}
                      </td>
                      <td className="p-3 text-center text-xs text-muted-foreground">
                        {d.donorState ?? d.state ?? "-"}
                      </td>
                      <td className="p-3 text-center text-xs text-muted-foreground">
                        {d.donationDate?.toLocaleDateString("pt-BR") ?? "-"}
                      </td>
                      <td className="p-3 text-center text-xs">{d.electionYear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Asset Declaration History */}
        {politician.assets.length > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden mb-6">
            <div className="p-4 border-b">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Declaração de Bens ({politician.assets.length} itens)
              </h2>
            </div>
            <div className="md:hidden divide-y">
              {politician.assets.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{a.description}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span>{a.assetType}</span>
                      <span>·</span>
                      <span>{a.electionYear}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(a.value.toString())}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Descrição</th>
                    <th className="text-right p-3 font-medium">Valor</th>
                    <th className="text-center p-3 font-medium">Ano</th>
                  </tr>
                </thead>
                <tbody>
                  {politician.assets.map((a) => (
                    <tr key={a.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-xs text-muted-foreground">{a.assetType}</td>
                      <td className="p-3 truncate max-w-[250px]">{a.description}</td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {formatCurrency(a.value.toString())}
                      </td>
                      <td className="p-3 text-center text-xs">{a.electionYear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Political Links */}
        {politician.links.length > 0 && (
          <div className="rounded-lg border border-orange-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-orange-500/30 bg-orange-500/5">
              <h2 className="text-base font-semibold text-orange-600">
                Vínculos Suspeitos ({politician.links.length})
              </h2>
            </div>
            <div className="divide-y">
              {politician.links.map((link) => {
                return (
                  <div key={link.id} className="p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">
                        {linkTypeLabels[link.linkType] ?? link.linkType}
                      </span>
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${strengthColor(link.strength)}`}
                      >
                        Força: {(link.strength * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm mb-2">{link.description}</p>
                    {link.entity && (
                      <Link
                        href={`/${locale}/entities/${link.entity.id}`}
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {link.entity.name} ({formatCnpj(link.entity.cnpj)}) —{" "}
                        {link.entity._count.contracts} contratos
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Related Alerts */}
        {relatedAlerts.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-card mb-6 overflow-hidden">
            <div className="p-4 border-b border-red-500/30 bg-red-500/5">
              <h2 className="text-base font-semibold text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Alertas Relacionados ({relatedAlerts.length})
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {relatedAlerts.map((alert) => (
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
                          : "bg-yellow-500"
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

      </div>
    </PageLayout>
  );
}

function InfoCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${highlight ? "border-orange-500/30" : ""}`}
    >
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p
        className={`text-lg font-bold ${highlight ? "text-orange-500" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "-"}</p>
    </div>
  );
}
