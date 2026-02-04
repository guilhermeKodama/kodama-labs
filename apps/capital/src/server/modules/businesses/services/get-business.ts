import type { DbClient } from "@capital/server/lib/prisma";
import { fetchBusinessById } from "../data/queries/fetch-businesses";

export async function getBusinessById(id: string, db: DbClient) {
  const business = await fetchBusinessById(id, db);
  if (!business) {
    throw new Error("Business not found");
  }
  return business;
}
