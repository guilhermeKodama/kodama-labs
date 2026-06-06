import { prisma } from "@sentinel/server/lib/prisma";
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

  const rows = await prisma.contract.findMany({
    where,
    orderBy,
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0,
    take,
    include: {
      entity: { select: { id: true, _count: { select: { sanctions: true } } } },
      _count: { select: { alerts: true } },
    },
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

  const totalCount = await prisma.contract.count({ where });

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
    sanctionCount: c.entity?._count.sanctions ?? 0,
    alertCount: c._count.alerts,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate?.toISOString() ?? null,
    entityId: c.entity?.id ?? null,
  }));

  const [contractTypes, states] = await Promise.all([
    prisma.contract.groupBy({ by: ["contractType"], where: { contractType: { not: null } }, _count: true, orderBy: { _count: { contractType: "desc" } }, take: 20 }),
    prisma.contract.groupBy({ by: ["unitState"], where: { unitState: { not: null } }, _count: true, orderBy: { unitState: "asc" } }),
  ]);

  const filterOptions = {
    contractType: contractTypes.filter((t) => t.contractType).map((t) => ({ label: `${t.contractType} (${t._count})`, value: t.contractType! })),
    state: states.filter((s) => s.unitState).map((s) => ({ label: s.unitState!, value: s.unitState! })),
  };

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
