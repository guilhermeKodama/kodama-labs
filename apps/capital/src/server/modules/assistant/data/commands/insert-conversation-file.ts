import type { DbClient } from "@capital/server/lib/prisma";
import type { StatementFileType } from "@/generated/prisma";
import type { ParsedPayload } from "../../services/detect-and-parse-file";
import { ForbiddenError } from "@capital/server/lib/auth-middleware";

interface InsertConversationFileInput {
  conversationId: string;
  fileType: StatementFileType;
  statementKind: string;
  blobUrl: string;
  pathname: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  parseStatus: "pending" | "parsed" | "failed" | "not_applicable";
  parsedPayload?: ParsedPayload;
  parseError?: string;
}

/**
 * Persist an uploaded statement file, after verifying the conversation
 * belongs to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function insertConversationFile(
  userId: string,
  input: InsertConversationFileInput,
  db: DbClient
) {
  const conversation = await db.agentConversation.findFirst({
    where: { id: input.conversationId },
    select: { userId: true },
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (conversation.userId !== userId) {
    throw new ForbiddenError("conversation");
  }

  return db.conversationFile.create({
    data: {
      conversationId: input.conversationId,
      userId,
      fileType: input.fileType,
      statementKind: input.statementKind,
      blobUrl: input.blobUrl,
      pathname: input.pathname,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName,
      parseStatus: input.parseStatus,
      parsedPayload: input.parsedPayload as object | undefined,
      parseError: input.parseError,
    },
  });
}
