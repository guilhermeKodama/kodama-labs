import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateBusinessData {
  name?: string;
  description?: string;
  defaultCurrency?: string;
  color?: string;
  taxRate?: number;
}

export async function updateBusiness(
  id: string,
  data: UpdateBusinessData,
  db: DbClient
) {
  return db.business.update({
    where: { id },
    data,
  });
}
