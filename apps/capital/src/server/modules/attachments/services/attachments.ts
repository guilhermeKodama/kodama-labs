import type { AttachmentKind, Prisma } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { buildAttachmentPath, deleteObject, putObject } from "@/lib/storage";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "../constants";

export const ATTACHMENT_OWNER_TYPES = ["entry", "transfer", "recurring"] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

/** Owner types of the MCP/assistant contracts, which predate the ledger. */
export const LEGACY_OWNER_TYPES = ["transaction", "transfer", "recurringTransaction", "recurringTransfer"] as const;
export type LegacyOwnerType = (typeof LEGACY_OWNER_TYPES)[number];
export const fromLegacyOwnerType = (t: LegacyOwnerType): AttachmentOwnerType =>
  t === "transaction" ? "entry" : t === "transfer" ? "transfer" : "recurring";

const OWNER_COLUMN = { entry: "ledgerEntryId", transfer: "transferGroupId", recurring: "recurringRuleId" } as const;

/** Allowed (kind, owner) pairs: bills on entries and recurring rules, receipts on entries, transfer receipts on transfers. */
const ALLOWED: Record<AttachmentKind, AttachmentOwnerType[]> = {
  BILL: ["entry", "recurring"],
  RECEIPT: ["entry"],
  TRANSFER_RECEIPT: ["transfer"],
};

const ownedBy = (userId: string): Prisma.AttachmentWhereInput => ({
  OR: [{ ledgerEntry: { userId } }, { transferGroup: { userId } }, { recurringRule: { userId } }],
});

export async function verifyOwnerAccess(userId: string, ownerType: AttachmentOwnerType, ownerId: string, db: DbClient) {
  const found =
    ownerType === "entry"
      ? await db.ledgerEntry.count({ where: { id: ownerId, userId } })
      : ownerType === "transfer"
        ? await db.transferGroup.count({ where: { id: ownerId, userId } })
        : await db.recurringRule.count({ where: { id: ownerId, userId } });
  if (!found) throw new LedgerError(`${ownerType === "entry" ? "Entry" : ownerType === "transfer" ? "Transfer" : "Recurring rule"} not found or access denied`, 404);
}

export async function listAttachments(userId: string, ownerType: AttachmentOwnerType, ownerId: string | undefined, db: DbClient) {
  const column = OWNER_COLUMN[ownerType];
  if (ownerId) {
    await verifyOwnerAccess(userId, ownerType, ownerId, db);
    return db.attachment.findMany({ where: { [column]: ownerId }, orderBy: { uploadedAt: "asc" } });
  }
  return db.attachment.findMany({ where: { [column]: { not: null }, ...ownedBy(userId) }, orderBy: { uploadedAt: "asc" } });
}

export async function uploadAttachment(
  userId: string,
  input: { kind: AttachmentKind; ownerType: AttachmentOwnerType; ownerId: string; file: { buffer: Buffer; mimeType: string; originalName: string } },
  db: DbClient
) {
  if (!ALLOWED[input.kind].includes(input.ownerType)) throw new LedgerError(`Attachment kind ${input.kind} is not allowed on ${input.ownerType}`, 422);
  if (input.file.buffer.byteLength > MAX_FILE_SIZE_BYTES) throw new LedgerError(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes`, 422);
  if (!ALLOWED_MIME_TYPES.has(input.file.mimeType)) throw new LedgerError(`Mime type ${input.file.mimeType} is not allowed`, 422);
  await verifyOwnerAccess(userId, input.ownerType, input.ownerId, db);
  const uploaded = await putObject(buildAttachmentPath(input.kind, input.ownerId, input.file.originalName), input.file.buffer, input.file.mimeType);
  return db.attachment.create({
    data: {
      kind: input.kind,
      blobUrl: uploaded.url,
      pathname: uploaded.pathname,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.buffer.byteLength,
      originalName: input.file.originalName,
      [OWNER_COLUMN[input.ownerType]]: input.ownerId,
    },
  });
}

export async function deleteAttachment(userId: string, attachmentId: string, db: DbClient) {
  const attachment = await db.attachment.findFirst({ where: { id: attachmentId, ...ownedBy(userId) } });
  if (!attachment) throw new LedgerError("Attachment not found", 404);
  // The row is the source of truth; a dangling blob beats a row pointing at nothing.
  try {
    await deleteObject(attachment.blobUrl);
  } catch (err) {
    console.warn("Failed to delete blob for attachment", attachmentId, err);
  }
  return db.attachment.delete({ where: { id: attachmentId } });
}

export function serializeAttachment(a: {
  id: string;
  kind: AttachmentKind;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  uploadedAt: Date;
  ledgerEntryId: string | null;
  transferGroupId: string | null;
  recurringRuleId: string | null;
}) {
  return {
    id: a.id,
    kind: a.kind,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    originalName: a.originalName,
    uploadedAt: a.uploadedAt.toISOString(),
    ledgerEntryId: a.ledgerEntryId,
    transferGroupId: a.transferGroupId,
    recurringRuleId: a.recurringRuleId,
    blobUrl: a.blobUrl,
  };
}
