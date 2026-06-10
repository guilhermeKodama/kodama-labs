import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { formatCnpj, formatCurrency, formatNumber, type AppLocale } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Building2, Users } from "lucide-react";

export default async function ShareholderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; cpfCnpj: string }>;
}) {
  const { locale, cpfCnpj: cpfCnpjParam } = await params;
  setRequestLocale(locale);

  const appLocale = locale as AppLocale;
  const t = await getTranslations("pages.network.shareholderDetail");
  const tTable = await getTranslations("pages.network.shareholderDetail.table");

  const decodedCpfCnpj = decodeURIComponent(cpfCnpjParam);

  const rows = await prisma.shareholder.findMany({
    where: { cpfCnpj: decodedCpfCnpj },
    orderBy: { name: "asc" },
    include: {
      entity: {
        select: {
          id: true,
          name: true,
          cnpj: true,
          _count: { select: { contracts: true } },
          contracts: { select: { value: true } },
        },
      },
    },
  });

  if (rows.length === 0) return notFound();

  // Build per-entity aggregates and dedupe by entityId (a shareholder row is
  // already unique per entity, but be defensive in case of duplicates).
  const byEntity = new Map<
    string,
    {
      entityId: string;
      entityName: string;
      entityCnpj: string;
      role: string;
      contractCount: number;
      totalContractValue: number;
    }
  >();

  for (const row of rows) {
    if (!row.entity) continue;
    const totalContractValue = row.entity.contracts.reduce(
      (sum, c) => sum + Number(c.value),
      0
    );
    byEntity.set(row.entity.id, {
      entityId: row.entity.id,
      entityName: row.entity.name,
      entityCnpj: row.entity.cnpj,
      role: row.role,
      contractCount: row.entity._count.contracts,
      totalContractValue,
    });
  }

  const companies = Array.from(byEntity.values()).sort(
    (a, b) => b.totalContractValue - a.totalContractValue
  );

  const canonicalName = rows[0]?.name ?? "";
  const allNames = Array.from(new Set(rows.map((r) => r.name).filter(Boolean)));
  const alternateNames = allNames.filter((n) => n !== canonicalName);

  return (
    <div className="max-w-5xl">
      <Link
        href={`/${locale}/network`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>

      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            {t("title", { name: canonicalName })}
          </h1>
          <p className="text-sm text-muted-foreground">{decodedCpfCnpj}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("subtitle")}</p>
          {alternateNames.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1 italic">
              {t("alsoKnownAs", { names: alternateNames.join(", ") })}
            </p>
          )}
        </div>
        <div className="flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-500 text-xs font-medium">
            <Users className="h-3.5 w-3.5" />
            {t("totalCompanies", { count: companies.length })}
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden mt-5">
        <div className="md:hidden divide-y">
          {companies.map((c) => (
            <Link
              key={c.entityId}
              href={`/${locale}/entities/${c.entityId}`}
              className="flex items-start justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 font-medium text-sm min-w-0">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{c.entityName}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {formatCnpj(c.entityCnpj)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span>{c.role}</span>
                  <span>·</span>
                  <span>{formatNumber(c.contractCount, appLocale)} contr.</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right text-sm font-medium tabular-nums">
                {formatCurrency(c.totalContractValue, appLocale)}
              </div>
            </Link>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{tTable("entity")}</th>
                <th className="text-left p-3 font-medium">{tTable("cnpj")}</th>
                <th className="text-left p-3 font-medium">{tTable("role")}</th>
                <th className="text-right p-3 font-medium">{tTable("contracts")}</th>
                <th className="text-right p-3 font-medium">{tTable("totalValue")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.entityId} className="border-b hover:bg-muted/30">
                  <td className="p-3">
                    <Link
                      href={`/${locale}/entities/${c.entityId}`}
                      className="inline-flex items-center gap-2 font-medium hover:underline"
                    >
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0 truncate">{c.entityName}</span>
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {formatCnpj(c.entityCnpj)}
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {c.role}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(c.contractCount, appLocale)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {formatCurrency(c.totalContractValue, appLocale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
