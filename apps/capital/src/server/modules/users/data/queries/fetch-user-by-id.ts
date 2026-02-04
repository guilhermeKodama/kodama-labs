import type { DbClient } from "@capital/server/lib/prisma";

export async function fetchUserById(userId: string, db: DbClient) {
  return db.user.findUnique({
    where: { id: userId },
    include: {
      personalAccount: true,
    },
  });
}
