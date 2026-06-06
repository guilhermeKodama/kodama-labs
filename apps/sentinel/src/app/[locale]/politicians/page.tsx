import { unstable_cache } from "next/cache";
import { prisma } from "@sentinel/server/lib/prisma";
import { cachedFilterOptions, smartCount } from "@sentinel/server/lib/list-helpers";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { PoliticiansTable } from "./table";

const PAGE_SIZE = 25;
const DEFAULT_LISTING_REVALIDATE_SECONDS = 60;

interface SerializedPolitician {
  id: string;
  name: string;
  ballotName: string | null;
  cpf: string;
  party: string | null;
  position: string;
  state: string | null;
  city: string | null;
  electionYear: number | null;
  elected: boolean;
  active: boolean;
  donationCount: number;
  linkCount: number;
}

interface ListingResult {
  rows: SerializedPolitician[];
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

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

const loadFilterOptions = () =>
  cachedFilterOptions("politicians", async () => {
    const [parties, positions, states, years] = await Promise.all([
      prisma.politician.groupBy({ by: ["party"], where: { party: { not: null } }, _count: true, orderBy: { _count: { party: "desc" } }, take: 50 }),
      prisma.politician.groupBy({ by: ["position"], _count: true, orderBy: { _count: { position: "desc" } }, take: 30 }),
      prisma.politician.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
      prisma.politician.groupBy({ by: ["electionYear"], where: { electionYear: { not: null } }, _count: true, orderBy: { electionYear: "desc" } }),
    ]);
    return {
      party: parties.filter((p) => p.party).map((p) => ({ label: `${p.party} (${p._count})`, value: p.party! })),
      position: positions.map((p) => ({ label: `${p.position} (${p._count})`, value: p.position })),
      state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
      year: years.filter((y) => y.electionYear).map((y) => ({ label: String(y.electionYear!), value: String(y.electionYear!) })),
    };
  });

async function fetchListing({
  where,
  cursorId,
  dir,
}: {
  where: Prisma.PoliticianWhereInput;
  cursorId: string;
  dir: "next" | "prev";
}): Promise<ListingResult> {
  const orderBy: Prisma.PoliticianOrderByWithRelationInput[] = [
    { active: "desc" },
    { elected: "desc" },
    { name: "asc" },
    { id: "asc" },
  ];
  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const [rowsRaw, totalCount] = await Promise.all([
    prisma.politician.findMany({
      where,
      orderBy,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take,
      select: {
        id: true,
        name: true,
        ballotName: true,
        cpf: true,
        party: true,
        position: true,
        state: true,
        city: true,
        electionYear: true,
        elected: true,
        active: true,
      },
    }),
    smartCount({
      tableName: "politicians",
      where: where as Record<string, unknown>,
      exactCount: () => prisma.politician.count({ where }),
    }),
  ]);

  const rows = dir === "prev" ? [...rowsRaw].reverse() : rowsRaw;
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

  const pageIds = pageRows.map((p) => p.id);
  const empty = new Map<string, number>();
  const [donationCountMap, linkCountMap] = pageIds.length === 0
    ? [empty, empty]
    : await Promise.all([
        prisma.campaignDonation.groupBy({ by: ["politicianId"], where: { politicianId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.politicianId, r._count]))),
        prisma.politicalLink.groupBy({ by: ["politicianId"], where: { politicianId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.politicianId, r._count]))),
      ]);

  const serialized: SerializedPolitician[] = pageRows.map((p) => ({
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
    donationCount: donationCountMap.get(p.id) ?? 0,
    linkCount: linkCountMap.get(p.id) ?? 0,
  }));

  return { rows: serialized, totalCount, nextCursor, prevCursor };
}

const fetchDefaultListing = unstable_cache(
  () => fetchListing({ where: {}, cursorId: "", dir: "next" }),
  ["politicians-default-listing-v1"],
  { revalidate: DEFAULT_LISTING_REVALIDATE_SECONDS },
);

function isDefaultState(sp: Record<string, string | string[] | undefined>): boolean {
  return (
    !sp.search &&
    !sp.status &&
    !sp.party &&
    !sp.position &&
    !sp.state &&
    !sp.year &&
    !sp.cursor &&
    !sp.dir
  );
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
  const dir: "next" | "prev" = String(sp.dir ?? "next") === "prev" ? "prev" : "next";
  const where = buildWhere(sp);

  const [listing, filterOptions] = await Promise.all([
    isDefaultState(sp) ? fetchDefaultListing() : fetchListing({ where, cursorId, dir }),
    loadFilterOptions(),
  ]);

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-5">{t("title")}</h1>
      <PoliticiansTable
        data={listing.rows}
        locale={locale}
        totalCount={listing.totalCount}
        nextCursor={listing.nextCursor}
        prevCursor={listing.prevCursor}
        filterOptions={filterOptions}
      />
    </PageLayout>
  );
}
