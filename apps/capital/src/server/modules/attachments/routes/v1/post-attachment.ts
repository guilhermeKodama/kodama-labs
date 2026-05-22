import { createRoute, z } from "@hono/zod-openapi";
import {
  CREATED,
  BAD_REQUEST,
  UNAUTHORIZED,
  INTERNAL_SERVER_ERROR,
} from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import type { AttachmentOwnerType } from "../../constants";
import { uploadAttachment } from "../../services/upload-attachment";
import { routeConfig } from "../../constants";
import { AttachmentSchema } from "./schema";

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

const FormSchema = z.object({
  file: z.custom<File>().openapi({ type: "string", format: "binary" }),
  kind: z.enum(["BILL", "RECEIPT", "TRANSFER_RECEIPT"]),
  ownerType: z.enum([
    "transaction",
    "transfer",
    "recurringTransaction",
    "recurringTransfer",
  ]),
  ownerId: z.string(),
});

export const route = createRoute({
  path: "/v1/attachments",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Upload an attachment",
  description:
    "Uploads a bill, receipt, or transfer-receipt file and links it to the target entity.",
  request: {
    body: {
      content: {
        "multipart/form-data": { schema: FormSchema },
      },
      required: true,
    },
  },
  responses: {
    [CREATED]: jsonContent(AttachmentSchema, "Attachment created"),
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
    const body = await c.req.parseBody();

    const file = body["file"];
    const kindRaw = body["kind"];
    const ownerTypeRaw = body["ownerType"];
    const ownerIdRaw = body["ownerId"];

    if (!(file instanceof File)) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "file is required" } },
        BAD_REQUEST,
      );
    }
    if (typeof kindRaw !== "string" || typeof ownerTypeRaw !== "string" || typeof ownerIdRaw !== "string") {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "kind, ownerType, and ownerId are required",
          },
        },
        BAD_REQUEST,
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const attachment = await uploadAttachment(
      userId,
      {
        kind: kindRaw as "BILL" | "RECEIPT" | "TRANSFER_RECEIPT",
        ownerType: ownerTypeRaw as AttachmentOwnerType,
        ownerId: ownerIdRaw,
        file: {
          buffer,
          mimeType: file.type,
          originalName: file.name,
        },
      },
      prisma,
    );

    return c.json(
      {
        id: attachment.id,
        kind: attachment.kind,
        blobUrl: attachment.blobUrl,
        pathname: attachment.pathname,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        originalName: attachment.originalName,
        uploadedAt: attachment.uploadedAt.toISOString(),
        transactionId: attachment.transactionId,
        transferId: attachment.transferId,
        recurringTransactionId: attachment.recurringTransactionId,
        recurringTransferId: attachment.recurringTransferId,
      },
      CREATED,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("not allowed") ||
      message.includes("access denied") ||
      message.includes("not found") ||
      message.includes("exceeds maximum")
    ) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR,
    );
  }
};
