import type { DbClient } from "@capital/server/lib/prisma";
import { uploadAttachment } from "../../attachments/services/upload-attachment";
import { listAttachments } from "../../attachments/services/list-attachments";
import { deleteAttachmentService } from "../../attachments/services/delete-attachment";
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
} from "../../attachments/constants";
import { fetchTransactionById } from "../../transactions/data/queries/fetch-transactions";

export interface AttachReceiptParams {
  transactionId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export interface ListAttachmentsParams {
  transactionId: string;
}

export interface DeleteAttachmentParams {
  attachmentId: string;
}

/**
 * Attach a receipt (image or PDF) to a transaction via base64 content.
 * 
 * This uses the same storage backend as the UI attachment uploader.
 * Files are stored either locally (development) or in Vercel Blob (production)
 * depending on BLOB_READ_WRITE_TOKEN configuration.
 */
export async function attachReceipt(
  userId: string,
  params: AttachReceiptParams,
  db: DbClient
) {
  // Verify transaction exists and user owns it
  const transaction = await fetchTransactionById(userId, params.transactionId, db);
  if (!transaction) {
    throw new Error("Transaction not found or access denied");
  }

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.has(params.mimeType)) {
    throw new Error(
      `Mime type ${params.mimeType} is not allowed. ` +
      `Accepted types: ${Array.from(ALLOWED_MIME_TYPES).join(", ")}`
    );
  }

  // Validate base64 content
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(params.contentBase64)) {
    throw new Error("Invalid base64 content");
  }

  // Decode base64 content
  let buffer: Buffer;
  try {
    buffer = Buffer.from(params.contentBase64, "base64");
    // Check if decoded size makes sense (should be ~75% of encoded size)
    const expectedSize = Math.floor((params.contentBase64.length * 3) / 4);
    if (buffer.byteLength < expectedSize * 0.5 || buffer.byteLength > expectedSize * 1.5) {
      throw new Error("Invalid base64 content");
    }
  } catch {
    throw new Error("Invalid base64 content");
  }

  // Validate file size
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File size ${buffer.byteLength} bytes exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB)`
    );
  }

  // Upload through the same service the UI uses
  const attachment = await uploadAttachment(
    userId,
    {
      kind: "RECEIPT",
      ownerType: "transaction",
      ownerId: params.transactionId,
      file: {
        buffer,
        mimeType: params.mimeType,
        originalName: params.filename,
      },
    },
    db
  );

  return {
    id: attachment.id,
    filename: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    url: attachment.blobUrl,
  };
}

/**
 * List all attachments for a transaction.
 * Returns attachments that can be viewed/downloaded in the UI.
 */
export async function listTransactionAttachments(
  userId: string,
  params: ListAttachmentsParams,
  db: DbClient
) {
  // Verify transaction exists and user owns it
  const transaction = await fetchTransactionById(userId, params.transactionId, db);
  if (!transaction) {
    throw new Error("Transaction not found or access denied");
  }

  const attachments = await listAttachments(
    userId,
    "transaction",
    params.transactionId,
    db
  );

  return {
    attachments: attachments.map((att) => ({
      id: att.id,
      filename: att.originalName,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      url: att.blobUrl,
      kind: att.kind,
      uploadedAt: att.uploadedAt.toISOString(),
    })),
  };
}

/**
 * Delete an attachment by ID.
 * Verifies the attachment belongs to a transaction owned by the user.
 */
export async function deleteAttachment(
  userId: string,
  params: DeleteAttachmentParams,
  db: DbClient
) {
  await deleteAttachmentService(userId, params.attachmentId, db);

  return {
    success: true,
    attachmentId: params.attachmentId,
  };
}
