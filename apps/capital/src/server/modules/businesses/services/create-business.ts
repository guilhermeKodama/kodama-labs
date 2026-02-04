import type { DbClient } from "@capital/server/lib/prisma";
import { insertBusiness } from "../data/commands/insert-business";

interface CreateBusinessInput {
  userId: string;
  name: string;
  description?: string;
  defaultCurrency: string;
  color?: string;
}

export async function createBusiness(input: CreateBusinessInput, db: DbClient) {
  return insertBusiness(input, db);
}
