import type { DbClient } from "@capital/server/lib/prisma";
import type { AttachmentOwnerType } from "../../constants";

/**
 * Fetch attachments for a specific owner. Ownership of the owner entity must be
 * verified by the caller before invoking this query.
 */
export async function fetchAttachmentsByOwner(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  db: DbClient,
) {
  return db.attachment.findMany({
    where: { [`${ownerType}Id`]: ownerId },
    orderBy: { uploadedAt: "asc" },
  });
}

/**
 * Fetch every attachment of a given owner type belonging to the user, joined
 * through the related entity so ownership is enforced at the query level.
 */
export async function fetchAttachmentsByOwnerType(
  userId: string,
  ownerType: AttachmentOwnerType,
  db: DbClient,
) {
  switch (ownerType) {
    case "transaction":
      return db.attachment.findMany({
        where: {
          transaction: {
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
    case "transfer":
      return db.attachment.findMany({
        where: {
          transfer: {
            OR: [
              { fromBusiness: { userId } },
              { fromPersonalAccount: { userId } },
              { toBusiness: { userId } },
              { toPersonalAccount: { userId } },
            ],
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
    case "recurringTransaction":
      return db.attachment.findMany({
        where: {
          recurringTransaction: {
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
    case "recurringTransfer":
      return db.attachment.findMany({
        where: {
          recurringTransfer: {
            OR: [
              { fromBusiness: { userId } },
              { fromPersonalAccount: { userId } },
              { toBusiness: { userId } },
              { toPersonalAccount: { userId } },
            ],
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
  }
}

/**
 * Fetch a single attachment by id, joined with its owner so the caller can
 * verify the authenticated user owns the parent entity.
 */
export async function fetchAttachmentWithOwner(id: string, db: DbClient) {
  return db.attachment.findUnique({
    where: { id },
    include: {
      transaction: {
        select: {
          id: true,
          business: { select: { userId: true } },
          personalAccount: { select: { userId: true } },
        },
      },
      transfer: {
        select: {
          id: true,
          fromBusiness: { select: { userId: true } },
          fromPersonalAccount: { select: { userId: true } },
          toBusiness: { select: { userId: true } },
          toPersonalAccount: { select: { userId: true } },
        },
      },
      recurringTransaction: {
        select: {
          id: true,
          business: { select: { userId: true } },
          personalAccount: { select: { userId: true } },
        },
      },
      recurringTransfer: {
        select: {
          id: true,
          fromBusiness: { select: { userId: true } },
          fromPersonalAccount: { select: { userId: true } },
          toBusiness: { select: { userId: true } },
          toPersonalAccount: { select: { userId: true } },
        },
      },
    },
  });
}
