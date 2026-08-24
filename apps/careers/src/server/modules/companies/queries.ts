import { prisma } from "../../lib/prisma";

export async function listFavoriteCompanies() {
  return prisma.company.findMany({
    where: { isFavorite: true },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });
}

export async function getCompanyDetail(slug: string) {
  return prisma.company.findUnique({
    where: { slug },
    include: {
      boards: true,
      notes: { orderBy: { updatedAt: "desc" } },
      jobs: {
        orderBy: [{ interest: "desc" }, { discoveredAt: "desc" }],
        include: { scores: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
}
