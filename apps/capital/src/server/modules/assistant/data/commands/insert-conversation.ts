import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Create a new conversation for the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function insertConversation(
  userId: string,
  data: { title?: string },
  db: DbClient
) {
  return db.agentConversation.create({
    data: { userId, title: data.title },
  });
}
