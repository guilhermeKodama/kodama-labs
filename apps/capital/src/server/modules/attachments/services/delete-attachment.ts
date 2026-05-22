import type { DbClient } from "@capital/server/lib/prisma";
import { deleteObject } from "@/lib/storage";
import { fetchAttachmentWithOwner } from "../data/queries/fetch-attachments";
import { deleteAttachmentRow } from "../data/commands/delete-attachment";

type OwnerLike = {
  business: { userId: string } | null;
  personalAccount: { userId: string } | null;
} | null;

type TransferOwnerLike = {
  fromBusiness: { userId: string } | null;
  fromPersonalAccount: { userId: string } | null;
  toBusiness: { userId: string } | null;
  toPersonalAccount: { userId: string } | null;
} | null;

function ownsTransactionLike(owner: OwnerLike, userId: string): boolean {
  if (!owner) return false;
  return (
    owner.business?.userId === userId ||
    owner.personalAccount?.userId === userId
  );
}

function ownsTransferLike(owner: TransferOwnerLike, userId: string): boolean {
  if (!owner) return false;
  return (
    owner.fromBusiness?.userId === userId ||
    owner.fromPersonalAccount?.userId === userId ||
    owner.toBusiness?.userId === userId ||
    owner.toPersonalAccount?.userId === userId
  );
}

export async function deleteAttachmentService(
  userId: string,
  attachmentId: string,
  db: DbClient,
) {
  const attachment = await fetchAttachmentWithOwner(attachmentId, db);
  if (!attachment) {
    throw new Error("Attachment not found");
  }

  const ownsParent =
    ownsTransactionLike(attachment.transaction, userId) ||
    ownsTransferLike(attachment.transfer, userId) ||
    ownsTransactionLike(attachment.recurringTransaction, userId) ||
    ownsTransferLike(attachment.recurringTransfer, userId);

  if (!ownsParent) {
    throw new Error("Attachment not found");
  }

  // Best-effort blob delete: removing the DB row is the source of truth, and a
  // dangling blob is preferable to a half-deleted state where the row is gone
  // but the user can still see / link the file.
  try {
    await deleteObject(attachment.blobUrl);
  } catch (err) {
    console.warn("Failed to delete blob for attachment", attachmentId, err);
  }

  return deleteAttachmentRow(attachmentId, db);
}
