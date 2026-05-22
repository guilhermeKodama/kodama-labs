import type { DbClient } from "@capital/server/lib/prisma";
import type { AttachmentKind } from "@/generated/prisma";
import { putObject, buildAttachmentPath } from "@/lib/storage";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AttachmentOwnerType,
} from "../constants";
import { insertAttachment } from "../data/commands/insert-attachment";
import { verifyOwnerAccess } from "./verify-owner";

interface UploadAttachmentInput {
  kind: AttachmentKind;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  file: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  };
}

/**
 * Allowed (kind, ownerType) combinations:
 *   BILL              + transaction
 *   BILL              + recurringTransaction
 *   RECEIPT           + transaction
 *   TRANSFER_RECEIPT  + transfer
 *
 * The owner table for transfer-receipt-on-recurring-transfer is reserved in
 * the schema for future use but not exposed through this endpoint yet.
 */
function assertKindOwnerCombo(
  kind: AttachmentKind,
  ownerType: AttachmentOwnerType,
): void {
  const isValid =
    (kind === "BILL" &&
      (ownerType === "transaction" || ownerType === "recurringTransaction")) ||
    (kind === "RECEIPT" && ownerType === "transaction") ||
    (kind === "TRANSFER_RECEIPT" && ownerType === "transfer");
  if (!isValid) {
    throw new Error(
      `Attachment kind ${kind} is not allowed on ${ownerType}`,
    );
  }
}

export async function uploadAttachment(
  userId: string,
  input: UploadAttachmentInput,
  db: DbClient,
) {
  assertKindOwnerCombo(input.kind, input.ownerType);

  if (input.file.buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes`,
    );
  }
  if (!ALLOWED_MIME_TYPES.has(input.file.mimeType)) {
    throw new Error(`Mime type ${input.file.mimeType} is not allowed`);
  }

  await verifyOwnerAccess(userId, input.ownerType, input.ownerId, db);

  const pathname = buildAttachmentPath(
    input.kind,
    input.ownerId,
    input.file.originalName,
  );
  const uploaded = await putObject(
    pathname,
    input.file.buffer,
    input.file.mimeType,
  );

  return insertAttachment(
    {
      kind: input.kind,
      blobUrl: uploaded.url,
      pathname: uploaded.pathname,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.buffer.byteLength,
      originalName: input.file.originalName,
      transactionId:
        input.ownerType === "transaction" ? input.ownerId : undefined,
      transferId: input.ownerType === "transfer" ? input.ownerId : undefined,
      recurringTransactionId:
        input.ownerType === "recurringTransaction" ? input.ownerId : undefined,
      recurringTransferId:
        input.ownerType === "recurringTransfer" ? input.ownerId : undefined,
    },
    db,
  );
}
