import type { DbClient } from "@capital/server/lib/prisma";

interface CreateBusinessData {
  userId: string;
  name: string;
  description?: string;
  defaultCurrency: string;
  color?: string;
}

export async function insertBusiness(data: CreateBusinessData, db: DbClient) {
  return db.business.create({
    data,
  });
}
