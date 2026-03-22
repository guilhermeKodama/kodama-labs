import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { ProcurementsTable } from "./table";

export default async function ProcurementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const procurements = await prisma.procurement.findMany({
    orderBy: { publishedAt: "desc" },
    take: 500,
    include: { _count: { select: { items: true, alerts: true, contracts: true } } },
  });

  const serialized = procurements.map((p) => ({
    id: p.id,
    orgName: p.orgName,
    orgCnpj: p.orgCnpj,
    modality: p.modality,
    description: p.description,
    legalBasis: p.legalBasis,
    estimatedValue: p.estimatedValue ? Number(p.estimatedValue) : null,
    approvedValue: p.approvedValue ? Number(p.approvedValue) : null,
    status: p.status,
    state: p.state,
    publishedAt: p.publishedAt.toISOString(),
    itemCount: p._count.items,
    alertCount: p._count.alerts,
    contractCount: p._count.contracts,
  }));

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Licitações</h1>
      <ProcurementsTable data={serialized} locale={locale} />
    </PageLayout>
  );
}
