import { prisma } from "@sentinel/server/lib/prisma";
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

  const rows = await prisma.entity.findMany({
    where,
    orderBy,
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0,
    take,
    include: {
      _count: { select: { contracts: true, shareholders: true, sanctions: true, alerts: true } },
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

  const totalCount = await prisma.entity.count({ where });

  const serialized = pageRows.map((e) => ({
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

  const [legalNatures, states] = await Promise.all([
    prisma.entity.groupBy({ by: ["legalNature"], where: { legalNature: { not: null } }, _count: true, orderBy: { _count: { legalNature: "desc" } }, take: 30 }),
    prisma.entity.groupBy({ by: ["state"], where: { state: { not: null } }, _count: true, orderBy: { state: "asc" } }),
  ]);

  const filterOptions = {
    legalNature: legalNatures.filter((n) => n.legalNature).map((n) => ({ label: `${n.legalNature} (${n._count})`, value: n.legalNature! })),
    state: states.filter((s) => s.state).map((s) => ({ label: s.state!, value: s.state! })),
  };

  return (
    <PageLayout>
      <h1 className="text-xl md:text-2xl font-bold mb-5">{t("title")}</h1>
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
