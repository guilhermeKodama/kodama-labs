import { prisma } from "@sentinel/server/lib/prisma";
import { cachedFilterOptions, smartCount } from "@sentinel/server/lib/list-helpers";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { ContractsTable } from "./table";

const PAGE_SIZE = 25;

function buildWhere(sp: Record<string, string | string[] | undefined>) {
  const where: Prisma.ContractWhereInput = {};

  const search = String(sp.search ?? "").trim();
  if (search) {
    where.OR = [
      { supplierName: { contains: search, mode: "insensitive" } },
      { supplierCnpj: { contains: search } },
      { orgName: { contains: search, mode: "insensitive" } },
      { objectDescription: { contains: search, mode: "insensitive" } },
    ];
  }

  const contractType = String(sp.contractType ?? "");
  if (contractType) where.contractType = contractType;

  const state = String(sp.state ?? "");
  if (state) where.unitState = state;

  return where;
}

const loadFilterOptions = () =>
  cachedFilterOptions("contracts", async () => {
    const [contractTypes, states] = await Promise.all([
      prisma.contract.groupBy({ by: ["contractType"], where: { contractType: { not: null } }, _count: true, orderBy: { _count: { contractType: "desc" } }, take: 20 }),
      prisma.contract.groupBy({ by: ["unitState"], where: { unitState: { not: null } }, _count: true, orderBy: { unitState: "asc" } }),
    ]);
    return {
      contractType: contractTypes.filter((t) => t.contractType).map((t) => ({ label: `${t.contractType} (${t._count})`, value: t.contractType! })),
      state: states.filter((s) => s.unitState).map((s) => ({ label: s.unitState!, value: s.unitState! })),
    };
  });

export default async function ContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.contracts");

  const sp = await searchParams;
  const cursorId = String(sp.cursor ?? "");
  const dir = String(sp.dir ?? "next");
  const where = buildWhere(sp);

  const orderBy: Prisma.ContractOrderByWithRelationInput[] = [
    { startDate: "desc" },
    { id: "asc" },
  ];

  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const [rowsRaw, totalCount, filterOptions] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take,
      select: {
        id: true,
        supplierName: true,
        supplierCnpj: true,
        supplierType: true,
        orgName: true,
        unitState: true,
        objectDescription: true,
        description: true,
        contractType: true,
        value: true,
        amendmentCount: true,
        startDate: true,
        endDate: true,
        entity: { select: { id: true } },
      },
    }),
    smartCount({
      tableName: "contracts",
      where: where as Record<string, unknown>,
      exactCount: () => prisma.contract.count({ where }),
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

  const pageIds = pageRows.map((c) => c.id);
  const supplierCnpjs = Array.from(new Set(pageRows.map((c) => c.supplierCnpj).filter(Boolean)));

  const empty = new Map<string, number>();
  const [alertCountMap, sanctionCountMap] = pageIds.length === 0
    ? [empty, empty]
    : await Promise.all([
        prisma.alert.groupBy({ by: ["contractId"], where: { contractId: { in: pageIds } }, _count: true })
          .then((rows) => new Map(rows.filter((r): r is typeof r & { contractId: string } => r.contractId !== null).map((r) => [r.contractId, r._count]))),
        supplierCnpjs.length === 0
          ? Promise.resolve(empty)
          : prisma.sanction.groupBy({ by: ["cnpjCpf"], where: { cnpjCpf: { in: supplierCnpjs } }, _count: true })
              .then((rows) => new Map(rows.map((r) => [r.cnpjCpf, r._count]))),
      ]);

  const serialized = pageRows.map((c) => ({
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
    sanctionCount: sanctionCountMap.get(c.supplierCnpj) ?? 0,
    alertCount: alertCountMap.get(c.id) ?? 0,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate?.toISOString() ?? null,
    entityId: c.entity?.id ?? null,
  }));

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-5">{t("title")}</h1>
      <ContractsTable
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
