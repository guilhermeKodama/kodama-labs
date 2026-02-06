import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransferDirection } from "@prisma/client";

interface CreateTransferData {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  date: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  recurringTransferId?: string;
}

/**
 * Insert a new transfer after verifying user ownership of both source and target entities.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param data - The transfer data
 * @throws If source or target entity is not owned by the user
 */
export async function insertTransfer(
  userId: string,
  data: CreateTransferData,
  db: DbClient
) {
  // MANDATORY: Verify user owns the source entity
  if (data.fromBusinessId) {
    const business = await db.business.findFirst({
      where: { id: data.fromBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Source business not found or access denied");
    }
  }

  if (data.fromPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: data.fromPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Source personal account not found or access denied");
    }
  }

  // MANDATORY: Verify user owns the target entity
  if (data.toBusinessId) {
    const business = await db.business.findFirst({
      where: { id: data.toBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Target business not found or access denied");
    }
  }

  if (data.toPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: data.toPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Target personal account not found or access denied");
    }
  }

  return db.transfer.create({
    data,
  });
}
