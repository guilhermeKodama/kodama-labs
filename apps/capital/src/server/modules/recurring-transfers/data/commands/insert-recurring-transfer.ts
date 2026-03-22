import type { DbClient } from "@capital/server/lib/prisma";
import type {
  EntityType,
  TransferDirection,
  RecurrenceFrequency,
} from "@/generated/prisma";

interface InsertRecurringTransferInput {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  nextDueDate: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
}

/**
 * Insert a new recurring transfer after verifying user ownership of both entities.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param input - The recurring transfer data
 * @throws If source or target entity is not owned by the user
 */
export async function insertRecurringTransfer(
  userId: string,
  input: InsertRecurringTransferInput,
  db: DbClient
) {
  // MANDATORY: Verify user owns the source entity
  if (input.fromBusinessId) {
    const business = await db.business.findFirst({
      where: { id: input.fromBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Source business not found or access denied");
    }
  }

  if (input.fromPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: input.fromPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Source personal account not found or access denied");
    }
  }

  // MANDATORY: Verify user owns the target entity
  if (input.toBusinessId) {
    const business = await db.business.findFirst({
      where: { id: input.toBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Target business not found or access denied");
    }
  }

  if (input.toPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: input.toPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Target personal account not found or access denied");
    }
  }

  return db.recurringTransfer.create({
    data: {
      fromEntityType: input.fromEntityType,
      toEntityType: input.toEntityType,
      direction: input.direction,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      description: input.description,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate,
      nextDueDate: input.nextDueDate,
      fromBusinessId: input.fromBusinessId,
      fromPersonalAccountId: input.fromPersonalAccountId,
      toBusinessId: input.toBusinessId,
      toPersonalAccountId: input.toPersonalAccountId,
    },
  });
}
