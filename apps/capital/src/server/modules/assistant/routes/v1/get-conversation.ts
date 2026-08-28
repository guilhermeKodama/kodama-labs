import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, NOT_FOUND, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { getConversation } from "../../services/get-conversation";
import { routeConfig } from "../../constants";

const MessageSchema = z.object({
  id: z.string(),
  turnId: z.string().nullable(),
  role: z.string(),
  content: z.unknown(),
  kind: z.string(),
  createdAt: z.string(),
});

const FileSchema = z.object({
  id: z.string(),
  fileType: z.enum(["ofx", "csv", "pdf"]),
  statementKind: z.string().nullable(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  parseStatus: z.enum(["pending", "parsed", "failed", "not_applicable"]),
  parseError: z.string().nullable(),
  createdAt: z.string(),
});

const PlanSchema = z.object({
  id: z.string(),
  kind: z.enum(["import", "revert"]),
  status: z.enum(["proposed", "confirmed", "committed", "rejected", "superseded", "reverted"]),
  fileId: z.string().nullable(),
  payload: z.unknown(),
  payloadHash: z.string(),
  summary: z.unknown(),
  warnings: z.unknown(),
  confirmedAt: z.string().nullable(),
  committedAt: z.string().nullable(),
  createdAt: z.string(),
});

const TurnSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});

const ConversationDetailSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  messages: z.array(MessageSchema),
  files: z.array(FileSchema),
  plans: z.array(PlanSchema),
  turns: z.array(TurnSchema),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const route = createRoute({
  path: "/v1/assistant/conversations/{id}",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Get a conversation",
  description:
    "Returns the full resume payload for a conversation: messages, files, plans and turn costs",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    [OK]: jsonContent(ConversationDetailSchema, "Conversation detail"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [NOT_FOUND]: jsonContent(ErrorResponseSchema, "Conversation not found"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { id } = c.req.valid("param");
    const conversation = await getConversation(userId, id, prisma);

    return c.json(
      {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          turnId: m.turnId,
          role: m.role,
          content: m.content,
          kind: m.kind,
          createdAt: m.createdAt.toISOString(),
        })),
        files: conversation.files.map((f) => ({
          id: f.id,
          fileType: f.fileType,
          statementKind: f.statementKind,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          // Prisma models this as a plain string column (see schema
          // comment on ConversationFile.parseStatus); only detect-and-parse-file.ts
          // ever writes it, always one of these four values.
          parseStatus: f.parseStatus as "pending" | "parsed" | "failed" | "not_applicable",
          parseError: f.parseError,
          createdAt: f.createdAt.toISOString(),
        })),
        plans: conversation.plans.map((p) => ({
          id: p.id,
          kind: p.kind,
          status: p.status,
          fileId: p.fileId,
          payload: p.payload,
          payloadHash: p.payloadHash,
          summary: p.summary,
          warnings: p.warnings,
          confirmedAt: p.confirmedAt?.toISOString() ?? null,
          committedAt: p.committedAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        })),
        turns: conversation.turns.map((t) => ({
          id: t.id,
          status: t.status,
          model: t.model,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          costUsd: Number(t.costUsd),
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt?.toISOString() ?? null,
          error: t.error,
        })),
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "NOT_FOUND", message } }, NOT_FOUND);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, INTERNAL_SERVER_ERROR);
  }
};
