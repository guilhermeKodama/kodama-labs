import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { PoliticiansTable } from "./table";

const PAGE_SIZE = 25;

function buildWhere(sp: Record<string, string | string[] | undefined>) {
  const where: Prisma.PoliticianWhereInput = {};

  const search = String(sp.search ?? "").trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { ballotName: { contains: search, mode: "insensitive" } },
      { cpf: { contains: search } },
    ];
  }

  const status = String(sp.status ?? "");
  if (status === "Ativo") where.active = true;
  else if (status === "Eleito") { where.elected = true; where.active = false; }
  else if (status === "Candidato") { where.elected = false; where.active = false; }

  const party = String(sp.party ?? "");
  if (party) where.party = party;

  const position = String(sp.position ?? "");
  if (position) where.position = position;

  const state = String(sp.state ?? "");
  if (state) where.state = state;

  const year = String(sp.year ?? "");
  if (year) where.electionYear = parseInt(year);

  return where;
}

export default async function PoliticiansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.politicians");

  const sp = await searchParams;
  const cursorId = String(sp.cursor ?? "");
  const dir = String(sp.dir ?? "next");
  const where = buildWhere(sp);

  const orderBy: Prisma.PoliticianOrderByWithRelationInput[] = [
    { active: "desc" },
    { elected: "desc" },
    { name: "asc" },
    { id: "asc" },
  ];

  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const rows = await prisma.politician.findMany({
    where,
    orderBy,
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0,
    take,
    include: { _count: { select: { donations: true, links: true } } },
  });

  if (dir === "prev") rows.reverse();

  const hasExtra = rows.length > PAGE_SIZE;
  const pageRows = hasExtra
    ? dir === "prev" ? rows.slice(1) : rows.slice(0, PAGE_SIZE)
    : rows;

  let nextCursor: string | null = null;
  let prevCursor: string | null = null;

  if (pageRows.length > 0) {
    const firstId = pageRows[0].id;
    const lastId = pageRows[pageRows.length - 1].id;

    if (dir === "prev") {
      nextCursor = lastId;
      prevCursor = hasExtra ? firstId : null;
    } else {
      nextCursor = hasExtra ? lastId : null;
      prevCursor = cursorId ? firstId : null;
    }
  }

  const totalCount = await prisma.politician.count({ where });

  const serialized = pageRows.map((p) => ({
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

  const [parties, positions, states, years] = await Promise.all([
    prisma.politician.groupBy({ by: ["party"], where: { party: { not: null } }, _count: true, orderBy: { _count: { party: "desc" } }, take: 50 }),
    prisma.politician.groupBy({ by: ["position"], _count: true, orderBy: { _count: { position: "desc" } }, take: 30 }),
    prisma.politician.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
    prisma.politician.groupBy({ by: ["electionYear"], where: { electionYear: { not: null } }, _count: true, orderBy: { electionYear: "desc" } }),
  ]);

  const filterOptions = {
    party: parties.filter((p) => p.party).map((p) => ({ label: `${p.party} (${p._count})`, value: p.party! })),
    position: positions.map((p) => ({ label: `${p.position} (${p._count})`, value: p.position })),
    state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
    year: years.filter((y) => y.electionYear).map((y) => ({ label: String(y.electionYear!), value: String(y.electionYear!) })),
  };

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">{t("title")}</h1>
      <PoliticiansTable
        data={serialized}
        locale={locale}
        totalCount={totalCount}
        nextCursor={nextCursor}
        prevCursor={prevCursor}
        filterOptions={filterOptions}
      />
    </PageLayout>
  );
}
