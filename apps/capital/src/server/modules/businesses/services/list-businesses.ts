import type { DbClient } from "@capital/server/lib/prisma";
import { fetchBusinessesByUserId } from "../data/queries/fetch-businesses";

export async function listBusinesses(userId: string, db: DbClient) {
  return fetchBusinessesByUserId(userId, db);
}
