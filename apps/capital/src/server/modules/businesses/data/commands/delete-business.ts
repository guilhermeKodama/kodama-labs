import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteBusiness(id: string, db: DbClient) {
  return db.business.delete({
    where: { id },
  });
}
