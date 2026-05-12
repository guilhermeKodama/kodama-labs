import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { AlertsClient } from "./alerts-client";

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [alerts, countBySeverity] = await Promise.all([
    prisma.alert.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        entity: { select: { id: true, cnpj: true, name: true, state: true } },
        procurement: { select: { id: true, description: true, orgName: true, state: true, modality: true } },
      },
    }),
    prisma.alert.groupBy({
      by: ["severity"],
      where: { resolvedAt: null },
      _count: true,
    }),
  ]);

  const serialized = alerts.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    title: a.title,
    description: a.description,
    createdAt: a.createdAt.toISOString(),
    resolved: !!a.resolvedAt,
    entityId: a.entity?.id ?? null,
    entityName: a.entity?.name ?? null,
    entityCnpj: a.entity?.cnpj ?? null,
    entityState: a.entity?.state ?? null,
    procurementId: a.procurement?.id ?? null,
    procurementOrgName: a.procurement?.orgName ?? null,
    procurementState: a.procurement?.state ?? null,
    procurementModality: a.procurement?.modality ?? null,
    state: a.entity?.state ?? a.procurement?.state ?? null,
  }));

  const severityCounts = {
    CRITICAL: countBySeverity.find((c) => c.severity === "CRITICAL")?._count ?? 0,
    HIGH: countBySeverity.find((c) => c.severity === "HIGH")?._count ?? 0,
    MEDIUM: countBySeverity.find((c) => c.severity === "MEDIUM")?._count ?? 0,
    LOW: countBySeverity.find((c) => c.severity === "LOW")?._count ?? 0,
  };

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Alertas</h1>
      <AlertsClient data={serialized} locale={locale} severityCounts={severityCounts} />
    </PageLayout>
  );
}
