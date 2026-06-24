import { prisma } from "@sentinel/server/lib/prisma";
import type { Politician } from "@/generated/prisma";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Building2, AlertTriangle, Link2 } from "lucide-react";
import { formatCnpj, formatDate, type AppLocale } from "@/lib/utils";

const strengthColor = (s: number) =>
  s >= 0.8
    ? "bg-red-500/20 text-red-500"
    : s >= 0.5
      ? "bg-orange-500/20 text-orange-500"
      : "bg-yellow-500/20 text-yellow-500";

/**
 * Vínculos & Alertas tab — existing political links and related alerts. Link
 * types are DB codes translated via codes.politicalLinkType (per the i18n
 * convention) instead of an inline label map.
 */
export async function VinculosSection({
  politician,
  locale,
}: {
  politician: Politician;
  locale: AppLocale;
}) {
  const tLink = await getTranslations("codes.politicalLinkType");

  const links = await prisma.politicalLink.findMany({
    where: { politicianId: politician.id },
    orderBy: { strength: "desc" },
    include: {
      entity: { select: { id: true, name: true, cnpj: true, state: true } },
    },
  });

  const linkedEntityCnpjs = Array.from(
    new Set(
      links.map((l) => l.entity?.cnpj).filter((c): c is string => Boolean(c)),
    ),
  );

  const [relatedAlerts, contractCountByCnpj] = await Promise.all([
    prisma.alert.findMany({
      where: {
        type: "POLITICAL_LINK",
        data: { path: ["politicianCpf"], equals: politician.cpf },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    linkedEntityCnpjs.length === 0
      ? Promise.resolve(new Map<string, number>())
      : prisma.contract
          .groupBy({
            by: ["supplierCnpj"],
            where: { supplierCnpj: { in: linkedEntityCnpjs } },
            _count: true,
          })
          .then((rows) => new Map(rows.map((r) => [r.supplierCnpj, r._count]))),
  ]);

  if (links.length === 0 && relatedAlerts.length === 0) {
    return (
      <EmptyState
        icon={<Link2 className="h-5 w-5" />}
        title="Nenhum vínculo ou alerta registrado"
        subtitle="Vínculos societários/financeiros e alertas relacionados a este político aparecerão aqui quando a análise os identificar."
      />
    );
  }

  return (
    <div className="space-y-6">
      {links.length > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-card overflow-hidden">
          <div className="p-4 border-b border-orange-500/30 bg-orange-500/5">
            <h2 className="text-base font-semibold text-orange-600">
              Vínculos a Revisar ({links.length})
            </h2>
          </div>
          <div className="divide-y">
            {links.map((link) => (
              <div key={link.id} className="p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">
                    {tLink(link.linkType)}
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
                    {contractCountByCnpj.get(link.entity.cnpj) ?? 0} contratos
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {relatedAlerts.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-card overflow-hidden">
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
                      {formatDate(alert.createdAt, locale)}
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
  );
}
