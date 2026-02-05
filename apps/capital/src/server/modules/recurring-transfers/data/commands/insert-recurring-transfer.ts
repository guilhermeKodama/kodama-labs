import type { DbClient } from "@capital/server/lib/prisma";
import type {
  EntityType,
  TransferDirection,
  RecurrenceFrequency,
} from "@prisma/client";

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

export async function insertRecurringTransfer(
  input: InsertRecurringTransferInput,
  db: DbClient
) {
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
