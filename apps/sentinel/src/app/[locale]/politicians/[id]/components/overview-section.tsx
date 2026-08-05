import { prisma } from "@sentinel/server/lib/prisma";
import type { Politician } from "@/generated/prisma";
import { Field } from "@/components/info-card";
import { ValueTrendChart } from "@/components/value-trend-chart";
import { DollarSign, TrendingUp } from "lucide-react";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/utils";

/**
 * Visão Geral tab — identity, personal data, financial summary, public-servant
 * link and the declared-asset trajectory (chart from data that already exists).
 */
export async function OverviewSection({
  politician,
  locale,
}: {
  politician: Politician;
  locale: AppLocale;
}) {
  const [assets, servants, donationAgg, pjAgg] = await Promise.all([
    prisma.candidateAsset.findMany({
      where: { politicianId: politician.id },
      orderBy: [{ electionYear: "desc" }, { value: "desc" }],
    }),
    prisma.publicServant.findMany({
      where: { politicianId: politician.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.campaignDonation.aggregate({
      where: { politicianId: politician.id },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.campaignDonation.aggregate({
      where: { politicianId: politician.id, donorType: "PJ" },
      _count: true,
      _sum: { amount: true },
    }),
  ]);

  const totalDonations = Number(donationAgg._sum.amount ?? 0);
  const totalPjDonations = Number(pjAgg._sum.amount ?? 0);

  // Declared-asset trajectory: total declared wealth per election year.
  const byYear = new Map<number, number>();
  for (const a of assets) {
    byYear.set(a.electionYear, (byYear.get(a.electionYear) ?? 0) + Number(a.value));
  }
  const trajectory = Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ label: String(year), value }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
            <Field label="Eleito" value={politician.elected ? "Sim" : "Não"} />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-3">Dados Pessoais</h2>
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            <Field
              label="Nascimento"
              value={
                politician.birthDate
                  ? formatDate(politician.birthDate, locale)
                  : null
              }
            />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-3">Resumo Financeiro</h2>
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            <Field
              label="Total de Doações"
              value={formatCurrency(totalDonations, locale)}
            />
            <Field
              label="Doações de Empresas (PJ)"
              value={formatCurrency(totalPjDonations, locale)}
            />
            <Field label="Nº de Doações" value={donationAgg._count.toString()} />
            <Field label="Doações PJ" value={pjAgg._count.toString()} />
          </div>
        </div>

        {servants.length > 0 && (
          <div className="rounded-lg border border-purple-500/30 bg-card p-5">
            <h2 className="text-base font-semibold mb-3 text-purple-600">
              Vínculo como Servidor Público
            </h2>
            <div className="space-y-3">
              {servants.map((s) => (
                <div
                  key={s.id}
                  className="text-sm grid grid-cols-2 gap-y-2 gap-x-4"
                >
                  <Field label="Cargo" value={s.cargo} />
                  <Field label="Função" value={s.funcao} />
                  <Field label="Órgão" value={s.orgao} />
                  <Field label="Situação" value={s.situacao} />
                  <Field
                    label="Remuneração"
                    value={
                      s.remuneracao
                        ? formatCurrency(s.remuneracao.toString(), locale)
                        : null
                    }
                  />
                  <Field
                    label="Admissão"
                    value={
                      s.dataAdmissao ? formatDate(s.dataAdmissao, locale) : null
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Declared-asset trajectory (uses data already ingested) */}
      {trajectory.length >= 2 && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Evolução Patrimonial Declarada
          </h2>
          <ValueTrendChart
            data={trajectory}
            valueFormatter={(v) => formatCurrency(v, locale)}
          />
        </div>
      )}

      {assets.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Declaração de Bens ({assets.length} itens)
            </h2>
          </div>
          <div className="md:hidden divide-y">
            {assets.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{a.description}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{a.assetType}</span>
                    <span>·</span>
                    <span>{a.electionYear}</span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right text-sm font-medium tabular-nums">
                  {formatCurrency(a.value.toString(), locale)}
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
                {assets.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3 text-xs text-muted-foreground">
                      {a.assetType}
                    </td>
                    <td className="p-3 truncate max-w-[250px]">
                      {a.description}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {formatCurrency(a.value.toString(), locale)}
                    </td>
                    <td className="p-3 text-center text-xs">{a.electionYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
