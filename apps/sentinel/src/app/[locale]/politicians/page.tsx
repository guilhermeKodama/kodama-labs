import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { PoliticiansTable } from "./table";

export default async function PoliticiansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const politicians = await prisma.politician.findMany({
    orderBy: [{ active: "desc" }, { elected: "desc" }, { name: "asc" }],
    take: 1000,
    include: {
      _count: { select: { donations: true, links: true } },
    },
  });

  const serialized = politicians.map((p) => ({
    id: p.id,
    name: p.name,
    ballotName: p.ballotName,
    cpf: p.cpf,
    party: p.party,
    position: p.position,
    state: p.state,
    city: p.city,
    electionYear: p.electionYear,
    elected: p.elected,
    active: p.active,
    donationCount: p._count.donations,
    linkCount: p._count.links,
  }));

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Políticos</h1>
      <PoliticiansTable data={serialized} locale={locale} />
    </PageLayout>
  );
}
