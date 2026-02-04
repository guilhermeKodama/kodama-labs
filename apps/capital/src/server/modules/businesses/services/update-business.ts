import type { DbClient } from "@capital/server/lib/prisma";
import { updateBusiness as updateBusinessCmd } from "../data/commands/update-business";
import { fetchBusinessById } from "../data/queries/fetch-businesses";

interface UpdateBusinessInput {
  name?: string;
  description?: string;
  defaultCurrency?: string;
  color?: string;
  taxRate?: number;
}

export async function updateBusinessService(
  id: string,
  input: UpdateBusinessInput,
  db: DbClient
) {
  const existing = await fetchBusinessById(id, db);
  if (!existing) {
    throw new Error("Business not found");
  }

  return updateBusinessCmd(id, input, db);
}
