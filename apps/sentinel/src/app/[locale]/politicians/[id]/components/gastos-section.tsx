import { prisma } from "@sentinel/server/lib/prisma";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { InfoCard } from "@/components/info-card";
import { ValueTrendChart } from "@/components/value-trend-chart";
import { Building2, DollarSign, Receipt } from "lucide-react";
import { formatCurrency, formatCnpj, type AppLocale } from "@/lib/utils";

function formatDoc(doc: string): string {
  return doc.length === 14
    ? formatCnpj(doc)
    : doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/**
 * Gastos tab — the money trail in one place: parliamentary quota (CEAP),
 * government contracts linked via political links, and campaign donations.
 */
export async function GastosSection({
  politicianId,
  locale,
}: {
  politicianId: string;
  locale: AppLocale;
}) {
  const [donations, links, expenseAgg, monthly, byCategory] = await Promise.all([
    prisma.campaignDonation.findMany({
      where: { politicianId },
      orderBy: { amount: "desc" },
    }),
    prisma.politicalLink.findMany({
      where: { politicianId },
      include: { entity: { select: { id: true, name: true, cnpj: true } } },
    }),
    prisma.parliamentaryExpense.aggregate({
      where: { politicianId },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.parliamentaryExpense.groupBy({
      by: ["year", "month"],
      where: { politicianId },
      _sum: { amount: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    prisma.parliamentaryExpense.groupBy({
      by: ["category"],
      where: { politicianId },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 8,
    }),
  ]);

  const linkedEntityCnpjs = Array.from(
    new Set(
      links.map((l) => l.entity?.cnpj).filter((c): c is string => Boolean(c)),
    ),
  );
  const contractCountByCnpj =
    linkedEntityCnpjs.length === 0
      ? new Map<string, number>()
      : await prisma.contract
          .groupBy({
            by: ["supplierCnpj"],
            where: { supplierCnpj: { in: linkedEntityCnpjs } },
            _count: true,
          })
          .then((rows) => new Map(rows.map((r) => [r.supplierCnpj, r._count])));

  const linkedEntities = links
    .filter((l) => l.entity)
    .map((l) => ({
      id: l.entity!.id,
      name: l.entity!.name,
      cnpj: l.entity!.cnpj,
      contracts: contractCountByCnpj.get(l.entity!.cnpj) ?? 0,
    }));

  const expenseTotal = Number(expenseAgg._sum.amount ?? 0);
  const topCategory = byCategory[0];
  const monthlyData = monthly.map((m) => ({
    label: `${String(m.month).padStart(2, "0")}/${String(m.year).slice(2)}`,
    value: Number(m._sum.amount ?? 0),
  }));

  return (
    <div className="space-y-6">
      {/* Cota parlamentar / CEAP */}
      {expenseAgg._count === 0 ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title="Gastos de cota parlamentar (CEAP) ainda não disponíveis"
          subtitle="Aplica-se a deputados federais. As despesas mensais com dinheiro público (passagens, combustível, escritório...) aparecem aqui quando processadas."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InfoCard
              label="Total em cota parlamentar"
              value={formatCurrency(expenseTotal, locale)}
            />
            <InfoCard
              label="Documentos"
              value={expenseAgg._count.toLocaleString("pt-BR")}
            />
            {topCategory && (
              <InfoCard label="Maior categoria" value={topCategory.category} />
            )}
          </div>

          {monthlyData.length >= 2 && (
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Gasto mensal (cota parlamentar)
              </h2>
              <ValueTrendChart
                data={monthlyData}
                color="var(--chart-2, var(--primary))"
                valueFormatter={(v) => formatCurrency(v, locale)}
              />
            </div>
          )}

          {byCategory.length > 0 && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="p-4 border-b">
                <h2 className="text-base font-semibold">Gasto por categoria</h2>
              </div>
              <div className="divide-y">
                {byCategory.map((c) => (
                  <div
                    key={c.category}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <span className="text-sm truncate">
                      {c.category || "—"}
                    </span>
                    <span className="text-sm font-medium tabular-nums flex-shrink-0">
                      {formatCurrency(Number(c._sum.amount ?? 0), locale)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Linked government suppliers/contracts */}
      {linkedEntities.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Fornecedores Vinculados ({linkedEntities.length})
            </h2>
          </div>
          <div className="divide-y">
            {linkedEntities.map((e) => (
              <Link
                key={e.id}
                href={`/${locale}/entities/${e.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{e.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {formatCnpj(e.cnpj)}
                  </div>
                </div>
                <span className="flex-shrink-0 text-xs text-muted-foreground">
                  {e.contracts} contrato(s)
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Campaign donations */}
      {donations.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Todas as Doações ({donations.length})
            </h2>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y">
            {donations.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {d.donorName}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {formatDoc(d.donorCpfCnpj)}
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
                  {formatCurrency(d.amount.toString(), locale)}
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Doador</th>
                  <th className="text-left p-3 font-medium">CPF/CNPJ</th>
                  <th className="text-center p-3 font-medium">Tipo</th>
                  <th className="text-right p-3 font-medium">Valor</th>
                  <th className="text-left p-3 font-medium">Atividade (CNAE)</th>
                  <th className="text-center p-3 font-medium">UF</th>
                  <th className="text-center p-3 font-medium">Ano</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3 max-w-[200px]">
                      <div className="font-medium truncate">{d.donorName}</div>
                      {d.donorNameRfb && d.donorNameRfb !== d.donorName && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          RFB: {d.donorNameRfb}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs font-mono">
                      {formatDoc(d.donorCpfCnpj)}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          d.donorType === "PJ"
                            ? "bg-blue-500/20 text-blue-600"
                            : d.donorType === "PF"
                              ? "bg-green-500/20 text-green-600"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {d.donorType ?? "-"}
                      </span>
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {formatCurrency(d.amount.toString(), locale)}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground truncate max-w-[150px]">
                      {d.donorCnae ?? "-"}
                    </td>
                    <td className="p-3 text-center text-xs text-muted-foreground">
                      {d.donorState ?? d.state ?? "-"}
                    </td>
                    <td className="p-3 text-center text-xs">{d.electionYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {donations.length === 0 && expenseAgg._count === 0 && linkedEntities.length === 0 && (
        <EmptyState
          icon={<DollarSign className="h-5 w-5" />}
          title="Nenhum dado financeiro disponível"
          subtitle="Doações, gastos de cota e contratos vinculados aparecerão aqui."
        />
      )}
    </div>
  );
}
