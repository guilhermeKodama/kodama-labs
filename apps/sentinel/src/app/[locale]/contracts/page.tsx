import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { ContractsTable } from "./table";

export default async function ContractsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const contracts = await prisma.contract.findMany({
    orderBy: { startDate: "desc" },
    take: 500,
    include: {
      entity: { select: { id: true, _count: { select: { sanctions: true } } } },
      _count: { select: { alerts: true } },
    },
  });

  const serialized = contracts.map((c) => ({
    id: c.id,
    supplierName: c.supplierName,
    supplierCnpj: c.supplierCnpj,
    supplierType: c.supplierType,
    orgName: c.orgName,
    unitState: c.unitState,
    objectDescription: c.objectDescription ?? c.description,
    contractType: c.contractType,
    value: Number(c.value),
    amendmentCount: c.amendmentCount,
    sanctionCount: c.entity?._count.sanctions ?? 0,
    alertCount: c._count.alerts,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate?.toISOString() ?? null,
    entityId: c.entity?.id ?? null,
  }));

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Contratos</h1>
      <ContractsTable data={serialized} locale={locale} />
    </PageLayout>
  );
}
