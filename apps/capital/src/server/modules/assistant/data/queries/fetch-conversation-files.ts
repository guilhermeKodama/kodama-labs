import type { DbClient } from "@capital/server/lib/prisma";

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchConversationFilesForAgent(
  conversationId: string,
  userId: string,
  db: DbClient
) {
  return db.conversationFile.findMany({
    where: { conversationId, userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileType: true,
      statementKind: true,
      originalName: true,
      sizeBytes: true,
      parseStatus: true,
      parseError: true,
      parsedPayload: true,
      createdAt: true,
    },
  });
}

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchConversationFileById(
  fileId: string,
  conversationId: string,
  userId: string,
  db: DbClient
) {
  return db.conversationFile.findFirst({
    where: { id: fileId, conversationId, userId },
  });
}
