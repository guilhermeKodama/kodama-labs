import type { DbClient } from "@capital/server/lib/prisma";

interface FetchConversationsFilters {
  limit?: number;
  cursor?: string;
}

/**
 * List conversations for the authenticated user, most recently active first.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchConversations(
  userId: string,
  filters: FetchConversationsFilters,
  db: DbClient
) {
  const limit = Math.min(filters.limit ?? 50, 100);
  return db.agentConversation.findMany({
    where: { userId, status: "active" },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    ...(filters.cursor && {
      skip: 1,
      cursor: { id: filters.cursor },
    }),
    select: {
      id: true,
      title: true,
      status: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
}

/**
 * Fetch the full resume payload for a conversation: messages, files, plans
 * and turn cost totals. Scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchConversationDetail(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.agentConversation.findFirst({
    where: { id, userId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      files: { orderBy: { createdAt: "asc" } },
      plans: { orderBy: { createdAt: "desc" } },
      turns: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          costUsd: true,
          createdAt: true,
          completedAt: true,
          error: true,
        },
      },
    },
  });
}

/**
 * Fetch a bare conversation row (ownership check only, no relations).
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchConversationById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.agentConversation.findFirst({ where: { id, userId } });
}
