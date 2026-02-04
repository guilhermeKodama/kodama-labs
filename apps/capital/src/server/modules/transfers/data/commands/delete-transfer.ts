import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteTransfer(id: string, db: DbClient) {
  return db.transfer.delete({
    where: { id },
  });
}
