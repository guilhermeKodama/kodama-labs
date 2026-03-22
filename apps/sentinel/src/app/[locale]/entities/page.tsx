import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { EntitiesTable } from "./table";

export default async function EntitiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const entities = await prisma.entity.findMany({
    orderBy: { riskScore: { sort: "desc", nulls: "last" } },
    take: 500,
    include: {
      _count: { select: { contracts: true, sanctions: true, shareholders: true, alerts: true } },
    },
  });

  const serialized = entities.map((e) => ({
    id: e.id,
    name: e.name,
    cnpj: e.cnpj,
    legalNature: e.legalNature,
    state: e.state,
    city: e.city,
    capital: e.capital ? Number(e.capital) : null,
    activityDesc: e.activityDesc,
    contractCount: e._count.contracts,
    shareholderCount: e._count.shareholders,
    sanctionCount: e._count.sanctions,
    alertCount: e._count.alerts,
    riskScore: e.riskScore,
    isShellCompany: e.isShellCompany,
  }));

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Entidades</h1>
      <EntitiesTable data={serialized} locale={locale} />
    </PageLayout>
  );
}
