import { createRoute, z } from "@hono/zod-openapi";
import {
  OK,
  BAD_REQUEST,
  UNAUTHORIZED,
  INTERNAL_SERVER_ERROR,
} from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { listAttachments } from "../../services/list-attachments";
import { routeConfig, type AttachmentOwnerType } from "../../constants";
import { AttachmentSchema } from "./schema";

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/attachments",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List attachments for an owner",
  request: {
    query: z.object({
      ownerType: z.enum([
        "transaction",
        "transfer",
        "recurringTransaction",
        "recurringTransfer",
      ]),
      ownerId: z.string(),
    }),
  },
  responses: {
    [OK]: jsonContent(z.array(AttachmentSchema), "Attachments retrieved"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error",
    ),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const { ownerType, ownerId } = c.req.valid("query");
    const attachments = await listAttachments(
      userId,
      ownerType as AttachmentOwnerType,
      ownerId,
      prisma,
    );

    return c.json(
      attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        blobUrl: a.blobUrl,
        pathname: a.pathname,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        originalName: a.originalName,
        uploadedAt: a.uploadedAt.toISOString(),
        transactionId: a.transactionId,
        transferId: a.transferId,
        recurringTransactionId: a.recurringTransactionId,
        recurringTransferId: a.recurringTransferId,
      })),
      OK,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR,
    );
  }
};
