import type { DbClient } from "@capital/server/lib/prisma";

export async function fetchBusinessesByUserId(userId: string, db: DbClient) {
  return db.business.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function fetchBusinessById(id: string, db: DbClient) {
  return db.business.findUnique({
    where: { id },
  });
}
