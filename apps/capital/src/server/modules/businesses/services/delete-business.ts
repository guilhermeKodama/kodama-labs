import type { DbClient } from "@capital/server/lib/prisma";
import { deleteBusiness as deleteBusinessCmd } from "../data/commands/delete-business";
import { fetchBusinessById } from "../data/queries/fetch-businesses";

export async function deleteBusinessService(id: string, db: DbClient) {
  const existing = await fetchBusinessById(id, db);
  if (!existing) {
    throw new Error("Business not found");
  }

  return deleteBusinessCmd(id, db);
}
