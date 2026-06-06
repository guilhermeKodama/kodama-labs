import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { ProcurementsTable } from "./table";

const PAGE_SIZE = 25;

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
  const dir = String(sp.dir ?? "next");
  const where = buildWhere(sp);

  const orderBy: Prisma.ProcurementOrderByWithRelationInput[] = [
    { publishedAt: "desc" },
    { id: "asc" },
  ];

  const take = dir === "prev" ? -(PAGE_SIZE + 1) : PAGE_SIZE + 1;

  const rows = await prisma.procurement.findMany({
    where,
    orderBy,
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0,
    take,
    include: { _count: { select: { items: true, alerts: true, contracts: true, documents: true } } },
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

  const totalCount = await prisma.procurement.count({ where });

  const serialized = pageRows.map((p) => ({
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
    documentCount: p._count.documents,
  }));

  const [modalities, statuses, states] = await Promise.all([
    prisma.procurement.groupBy({ by: ["modality"], _count: true, orderBy: { _count: { modality: "desc" } }, take: 30 }),
    prisma.procurement.groupBy({ by: ["status"], where: { status: { not: "" } }, _count: true, orderBy: { _count: { status: "desc" } }, take: 20 }),
    prisma.procurement.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
  ]);

  const filterOptions = {
    modality: modalities.map((m) => ({ label: `${m.modality} (${m._count})`, value: m.modality })),
    status: statuses.filter((s) => s.status).map((s) => ({ label: s.status!, value: s.status! })),
    state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
  };

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-5">{t("title")}</h1>
      <ProcurementsTable
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
