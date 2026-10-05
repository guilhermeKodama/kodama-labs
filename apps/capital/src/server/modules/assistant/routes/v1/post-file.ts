import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, NOT_FOUND, UNAUTHORIZED, UNPROCESSABLE_ENTITY, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { uploadConversationFile } from "../../services/upload-conversation-file";
import { routeConfig } from "../../constants";

const FormSchema = z.object({
  file: z.custom<File>().openapi({ type: "string", format: "binary" }),
});

const ConversationFileSchema = z.object({
  id: z.string(),
  fileType: z.enum(["ofx", "csv", "pdf", "image"]),
  statementKind: z.string().nullable(),
  originalName: z.string(),
  mimeType: z.string(),
  blobUrl: z.string(),
  sizeBytes: z.number(),
  parseStatus: z.enum(["pending", "parsed", "failed", "not_applicable"]),
  parseError: z.string().nullable(),
});

export const route = createRoute({
  path: "/v1/assistant/conversations/{id}/files",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Upload a statement file or image into a conversation",
  description:
    "Uploads an OFX/CSV/PDF statement or an image (screenshot/receipt), storing the blob and parsing OFX/CSV deterministically",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "multipart/form-data": { schema: FormSchema } },
      required: true,
    },
  },
  responses: {
    [CREATED]: jsonContent(ConversationFileSchema, "File uploaded"),
    [BAD_REQUEST]: jsonContent(ApiErrorSchema, "No file in the form"),
    [NOT_FOUND]: jsonContent(ApiErrorSchema, "Conversation not found"),
    [UNPROCESSABLE_ENTITY]: jsonContent(ApiErrorSchema, "File too large or of an unsupported type"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const userId = requireUserId(c);
  const { id: conversationId } = c.req.valid("param");
  const body = await c.req.parseBody();

  const file = body["file"];
  if (!(file instanceof File)) {
    throw new LedgerError("file is required", 400, { code: "assistant.file_required" });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const conversationFile = await uploadConversationFile(
    userId,
    {
      conversationId,
      file: { buffer, mimeType: file.type, originalName: file.name },
    },
    prisma
  );

  return c.json(
    {
      id: conversationFile.id,
      fileType: conversationFile.fileType,
      statementKind: conversationFile.statementKind,
      originalName: conversationFile.originalName,
      mimeType: conversationFile.mimeType,
      blobUrl: conversationFile.blobUrl,
      sizeBytes: conversationFile.sizeBytes,
      parseStatus: conversationFile.parseStatus as "pending" | "parsed" | "failed" | "not_applicable",
      parseError: conversationFile.parseError,
    },
    CREATED
  );
};
