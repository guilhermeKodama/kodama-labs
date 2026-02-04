import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";
import { fetchCategoriesByUserId } from "../data/queries/fetch-categories";

export async function listCategories(
  userId: string,
  type?: TransactionType,
  db?: DbClient
) {
  return fetchCategoriesByUserId(userId, type, db);
}
