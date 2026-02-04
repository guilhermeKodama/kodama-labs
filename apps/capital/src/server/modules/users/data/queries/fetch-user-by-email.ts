import type { DbClient } from "@capital/server/lib/prisma";

export async function fetchUserByEmail(email: string, db: DbClient) {
  return db.user.findUnique({
    where: { email },
    include: {
      personalAccount: true,
    },
  });
}
