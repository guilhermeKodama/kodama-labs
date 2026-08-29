import type { DbClient } from "@capital/server/lib/prisma";
import { fetchConversations } from "../data/queries/fetch-conversations";

export async function listConversations(
  userId: string,
  filters: { limit?: number; cursor?: string },
  db: DbClient
) {
  return fetchConversations(userId, filters, db);
}
