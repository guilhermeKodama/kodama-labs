import { prisma } from "@sentinel/server/lib/prisma";
import { cachedFilterOptions, smartCount } from "@sentinel/server/lib/list-helpers";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { EntitiesTable } from "./table";

const PAGE_SIZE = 25;

function buildWhere(sp: Record<string, string | string[] | undefined>) {
  const where: Prisma.EntityWhereInput = {};

  const search = String(sp.search ?? "").trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { cnpj: { contains: search } },
      { activityDesc: { contains: search, mode: "insensitive" } },
    ];
  }

  const legalNature = String(sp.legalNature ?? "");
  if (legalNature) where.legalNature = legalNature;

  const state = String(sp.state ?? "");
  if (state) where.state = state;

  const shell = String(sp.shell ?? "");
  if (shell === "true") where.isShellCompany = true;
  else if (shell === "false") where.isShellCompany = false;

  return where;
}

const loadFilterOptions = () =>
  cachedFilterOptions("entities", async () => {
    const [legalNatures, states] = await Promise.all([
      prisma.entity.groupBy({ by: ["legalNature"], where: { legalNature: { not: null } }, _count: true, orderBy: { _count: { legalNature: "desc" } }, take: 30 }),
      prisma.entity.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
    ]);
    return {
      legalNature: legalNatures.filter((n) => n.legalNature).map((n) => ({ label: `${n.legalNature} (${n._count})`, value: n.legalNature! })),
      state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
    };
  });

export default async function EntitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.entities");

  const sp = await searchParams;
  const cursorId = String(sp.cursor ?? "");
  const dir = String(sp.dir ?? "next");
  const where = buildWhere(sp);

  const orderBy: Prisma.EntityOrderByWithRelationInput[] = [
    { riskScore: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ];

  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const [rowsRaw, totalCount, filterOptions] = await Promise.all([
    prisma.entity.findMany({
      where,
      orderBy,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take,
    }),
    smartCount({
      tableName: "entities",
      where: where as Record<string, unknown>,
      exactCount: () => prisma.entity.count({ where }),
    }),
    loadFilterOptions(),
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

  const pageIds = pageRows.map((e) => e.id);
  const pageCnpjs = pageRows.map((e) => e.cnpj);

  const empty = new Map<string, number>();
  const [contractCountMap, shareholderCountMap, sanctionCountMap, alertCountMap] = pageIds.length === 0
    ? [empty, empty, empty, empty]
    : await Promise.all([
        prisma.contract.groupBy({ by: ["supplierCnpj"], where: { supplierCnpj: { in: pageCnpjs } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.supplierCnpj, r._count]))),
        prisma.shareholder.groupBy({ by: ["entityId"], where: { entityId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.map((r) => [r.entityId, r._count]))),
        prisma.sanction.groupBy({ by: ["entityId"], where: { entityId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.filter((r): r is typeof r & { entityId: string } => r.entityId !== null).map((r) => [r.entityId, r._count]))),
        prisma.alert.groupBy({ by: ["entityId"], where: { entityId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.filter((r): r is typeof r & { entityId: string } => r.entityId !== null).map((r) => [r.entityId, r._count]))),
      ]);

  const serialized = pageRows.map((e) => ({
    id: e.id,
    name: e.name,
    cnpj: e.cnpj,
    legalNature: e.legalNature,
    state: e.state,
    city: e.city,
    capital: e.capital ? Number(e.capital) : null,
    activityDesc: e.activityDesc,
    contractCount: contractCountMap.get(e.cnpj) ?? 0,
    shareholderCount: shareholderCountMap.get(e.id) ?? 0,
    sanctionCount: sanctionCountMap.get(e.id) ?? 0,
    alertCount: alertCountMap.get(e.id) ?? 0,
    riskScore: e.riskScore,
    isShellCompany: e.isShellCompany,
  }));

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">{t("title")}</h1>
      <EntitiesTable
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
