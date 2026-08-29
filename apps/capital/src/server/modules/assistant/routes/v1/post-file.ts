import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { uploadConversationFile } from "../../services/upload-conversation-file";
import { routeConfig } from "../../constants";

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const FormSchema = z.object({
  file: z.custom<File>().openapi({ type: "string", format: "binary" }),
});

const ConversationFileSchema = z.object({
  id: z.string(),
  fileType: z.enum(["ofx", "csv", "pdf"]),
  statementKind: z.string().nullable(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  parseStatus: z.enum(["pending", "parsed", "failed", "not_applicable"]),
  parseError: z.string().nullable(),
});

export const route = createRoute({
  path: "/v1/assistant/conversations/{id}/files",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Upload a statement file into a conversation",
  description:
    "Uploads an OFX/CSV/PDF statement, storing the blob and parsing OFX/CSV deterministically",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "multipart/form-data": { schema: FormSchema } },
      required: true,
    },
  },
  responses: {
    [CREATED]: jsonContent(ConversationFileSchema, "File uploaded"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid file"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id: conversationId } = c.req.valid("param");
    const body = await c.req.parseBody();

    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "file is required" } },
        BAD_REQUEST
      );
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
        sizeBytes: conversationFile.sizeBytes,
        parseStatus: conversationFile.parseStatus as "pending" | "parsed" | "failed" | "not_applicable",
        parseError: conversationFile.parseError,
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("exceeds maximum") ||
      message.includes("Unrecognized file type") ||
      message.includes("not found") ||
      message.includes("access denied")
    ) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
