import { unstable_cache } from "next/cache";
import { prisma } from "@sentinel/server/lib/prisma";
import { cachedFilterOptions, smartCount } from "@sentinel/server/lib/list-helpers";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProcurementsTable } from "./table";

const PAGE_SIZE = 25;
const DEFAULT_LISTING_REVALIDATE_SECONDS = 60;

interface SerializedProcurement {
  id: string;
  orgName: string;
  orgCnpj: string;
  modality: string;
  description: string;
  legalBasis: string | null;
  estimatedValue: number | null;
  approvedValue: number | null;
  status: string | null;
  state: string | null;
  publishedAt: string;
  itemCount: number;
  alertCount: number;
  contractCount: number;
  documentCount: number;
}

interface ListingResult {
  rows: SerializedProcurement[];
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

function buildWhere(sp: Record<string, string | string[] | undefined>) {
  const where: Prisma.ProcurementWhereInput = {};

  const search = String(sp.search ?? "").trim();
  if (search) {
    where.OR = [
      { orgName: { contains: search, mode: "insensitive" } },
      { orgCnpj: { contains: search } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const modality = String(sp.modality ?? "");
  if (modality) where.modality = modality;

  const status = String(sp.status ?? "");
  if (status) where.status = status;

  const state = String(sp.state ?? "");
  if (state) where.state = state;

  return where;
}

const loadFilterOptions = () =>
  cachedFilterOptions("procurements", async () => {
    const [modalities, statuses, states] = await Promise.all([
      prisma.procurement.groupBy({ by: ["modality"], _count: true, orderBy: { _count: { modality: "desc" } }, take: 30 }),
      prisma.procurement.groupBy({ by: ["status"], where: { status: { not: "" } }, _count: true, orderBy: { _count: { status: "desc" } }, take: 20 }),
      prisma.procurement.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
    ]);
    return {
      modality: modalities.map((m) => ({ label: `${m.modality} (${m._count})`, value: m.modality })),
      status: statuses.filter((s) => s.status).map((s) => ({ label: s.status!, value: s.status! })),
      state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
    };
  });

async function fetchListing({
  where,
  cursorId,
  dir,
}: {
  where: Prisma.ProcurementWhereInput;
  cursorId: string;
  dir: "next" | "prev";
}): Promise<ListingResult> {
  const orderBy: Prisma.ProcurementOrderByWithRelationInput[] = [
    { publishedAt: "desc" },
    { id: "asc" },
  ];
  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const [rowsRaw, totalCount] = await Promise.all([
    prisma.procurement.findMany({
      where,
      orderBy,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take,
    }),
    smartCount({
      tableName: "procurements",
      where: where as Record<string, unknown>,
      exactCount: () => prisma.procurement.count({ where }),
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
  const emptyCounts = new Map<string, number>();
  const [itemCountMap, alertCountMap, contractCountMap, docCountMap] = pageIds.length === 0
    ? [emptyCounts, emptyCounts, emptyCounts, emptyCounts]
    : await Promise.all([
        prisma.procurementItem.groupBy({ by: ["procurementId"], where: { procurementId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.procurementId, r._count]))),
        prisma.alert.groupBy({ by: ["procurementId"], where: { procurementId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.filter((r): r is typeof r & { procurementId: string } => r.procurementId !== null).map((r) => [r.procurementId, r._count]))),
        prisma.contract.groupBy({ by: ["procurementId"], where: { procurementId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.filter((r): r is typeof r & { procurementId: string } => r.procurementId !== null).map((r) => [r.procurementId, r._count]))),
        prisma.procurementDocument.groupBy({ by: ["procurementId"], where: { procurementId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.procurementId, r._count]))),
      ]);

  const serialized: SerializedProcurement[] = pageRows.map((p) => ({
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
    itemCount: itemCountMap.get(p.id) ?? 0,
    alertCount: alertCountMap.get(p.id) ?? 0,
    contractCount: contractCountMap.get(p.id) ?? 0,
    documentCount: docCountMap.get(p.id) ?? 0,
  }));

  return { rows: serialized, totalCount, nextCursor, prevCursor };
}

const fetchDefaultListing = unstable_cache(
  () => fetchListing({ where: {}, cursorId: "", dir: "next" }),
  ["procurements-default-listing-v1"],
  { revalidate: DEFAULT_LISTING_REVALIDATE_SECONDS },
);

function isDefaultState(sp: Record<string, string | string[] | undefined>): boolean {
  return !sp.search && !sp.modality && !sp.status && !sp.state && !sp.cursor && !sp.dir;
}

export default async function ProcurementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.procurements");

  const sp = await searchParams;
  const cursorId = String(sp.cursor ?? "");
  const dir: "next" | "prev" = String(sp.dir ?? "next") === "prev" ? "prev" : "next";
  const where = buildWhere(sp);

  const [listing, filterOptions] = await Promise.all([
    isDefaultState(sp) ? fetchDefaultListing() : fetchListing({ where, cursorId, dir }),
    loadFilterOptions(),
  ]);

  return (
    <>
      <h1 className="text-xl md:text-2xl font-bold mb-5">{t("title")}</h1>
      <ProcurementsTable
        data={listing.rows}
        locale={locale}
        totalCount={listing.totalCount}
        nextCursor={listing.nextCursor}
        prevCursor={listing.prevCursor}
        filterOptions={filterOptions}
      />
    </>
  );
}
