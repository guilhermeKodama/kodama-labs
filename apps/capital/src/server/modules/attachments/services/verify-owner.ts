import type { DbClient } from "@capital/server/lib/prisma";
import type { AttachmentOwnerType } from "../constants";

/**
 * Verify the authenticated user owns the entity that will receive the attachment.
 * Throws when the entity is missing or not owned by the user.
 */
export async function verifyOwnerAccess(
  userId: string,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  db: DbClient,
): Promise<void> {
  switch (ownerType) {
    case "transaction": {
      const row = await db.transaction.findFirst({
        where: {
          id: ownerId,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        select: { id: true },
      });
      if (!row) throw new Error("Transaction not found or access denied");
      return;
    }
    case "transfer": {
      const row = await db.transfer.findFirst({
        where: {
          id: ownerId,
          OR: [
            { fromBusiness: { userId } },
            { fromPersonalAccount: { userId } },
            { toBusiness: { userId } },
            { toPersonalAccount: { userId } },
          ],
        },
        select: { id: true },
      });
      if (!row) throw new Error("Transfer not found or access denied");
      return;
    }
    case "recurringTransaction": {
      const row = await db.recurringTransaction.findFirst({
        where: {
          id: ownerId,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        select: { id: true },
      });
      if (!row) {
        throw new Error("Recurring transaction not found or access denied");
      }
      return;
    }
    case "recurringTransfer": {
      const row = await db.recurringTransfer.findFirst({
        where: {
          id: ownerId,
          OR: [
            { fromBusiness: { userId } },
            { fromPersonalAccount: { userId } },
            { toBusiness: { userId } },
            { toPersonalAccount: { userId } },
          ],
        },
        select: { id: true },
      });
      if (!row) {
        throw new Error("Recurring transfer not found or access denied");
      }
      return;
    }
  }
}
