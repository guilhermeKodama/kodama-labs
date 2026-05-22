import type { DbClient } from "@capital/server/lib/prisma";
import type { AttachmentKind } from "@/generated/prisma";

interface InsertAttachmentData {
  kind: AttachmentKind;
  blobUrl: string;
  pathname: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  transactionId?: string;
  transferId?: string;
  recurringTransactionId?: string;
  recurringTransferId?: string;
}

export async function insertAttachment(data: InsertAttachmentData, db: DbClient) {
  return db.attachment.create({ data });
}
