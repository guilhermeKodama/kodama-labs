import { randomUUID } from "node:crypto";
import { slugify, sanitizeExtension, joinPath } from "@repo/storage";
import type { DbClient } from "@capital/server/lib/prisma";
import { putObject } from "@/lib/storage";
import { MAX_STATEMENT_FILE_BYTES } from "../constants";
import { detectFile, parseStatementFile } from "./detect-and-parse-file";
import { insertConversationFile } from "../data/commands/insert-conversation-file";

interface UploadConversationFileInput {
  conversationId: string;
  file: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  };
}

function pickExtension(originalName: string): string {
  const match = originalName.match(/\.([a-zA-Z0-9]{1,8})$/);
  return match ? match[1]!.toLowerCase() : "bin";
}

function buildConversationFilePath(conversationId: string, originalName: string): string {
  const ext = sanitizeExtension(pickExtension(originalName));
  const slug =
    slugify(originalName.replace(/\.[a-zA-Z0-9]+$/, "")).slice(0, 60) || "file";
  return joinPath("capital", "conversations", conversationId, `${randomUUID()}-${slug}.${ext}`);
}

/**
 * Upload a statement file into a conversation's context: store the blob,
 * then parse OFX/CSV deterministically so the agent reads structured rows
 * via a tool instead of transcribing the file itself. PDFs are stored but
 * left unparsed - they go to Claude as document blocks when referenced.
 */
export async function uploadConversationFile(
  userId: string,
  input: UploadConversationFileInput,
  db: DbClient
) {
  if (input.file.buffer.byteLength > MAX_STATEMENT_FILE_BYTES) {
    throw new Error(
      `File exceeds maximum size of ${MAX_STATEMENT_FILE_BYTES} bytes`
    );
  }

  const detected = detectFile(input.file.buffer, input.file.originalName);
  if (detected.statementKind === "unknown") {
    throw new Error(
      "Unrecognized file type - only OFX, CSV and PDF statements are allowed"
    );
  }

  const pathname = buildConversationFilePath(input.conversationId, input.file.originalName);
  const uploaded = await putObject(pathname, input.file.buffer, input.file.mimeType);

  const parsed = parseStatementFile(input.file.buffer, detected);

  return insertConversationFile(
    userId,
    {
      conversationId: input.conversationId,
      fileType: detected.fileType,
      statementKind: detected.statementKind,
      blobUrl: uploaded.url,
      pathname: uploaded.pathname,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.buffer.byteLength,
      originalName: input.file.originalName,
      parseStatus: parsed.parseStatus,
      parsedPayload: parsed.parsedPayload,
      parseError: parsed.parseError,
    },
    db
  );
}
