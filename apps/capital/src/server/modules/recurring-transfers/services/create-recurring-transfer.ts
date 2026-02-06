import type { DbClient } from "@capital/server/lib/prisma";
import type {
  EntityType,
  TransferDirection,
  RecurrenceFrequency,
} from "@prisma/client";
import { insertRecurringTransfer } from "../data/commands/insert-recurring-transfer";

interface CreateRecurringTransferInput {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
}

export async function createRecurringTransfer(
  userId: string,
  input: CreateRecurringTransferInput,
  db: DbClient
) {
  // Validate from entity
  if (input.fromEntityType === "business" && !input.fromBusinessId) {
    throw new Error("fromBusinessId is required for business from entity type");
  }
  if (input.fromEntityType === "personal" && !input.fromPersonalAccountId) {
    throw new Error(
      "fromPersonalAccountId is required for personal from entity type"
    );
  }

  // Validate to entity
  if (input.toEntityType === "business" && !input.toBusinessId) {
    throw new Error("toBusinessId is required for business to entity type");
  }
  if (input.toEntityType === "personal" && !input.toPersonalAccountId) {
    throw new Error(
      "toPersonalAccountId is required for personal to entity type"
    );
  }

  // Data layer will verify ownership
  return insertRecurringTransfer(
    userId,
    {
      ...input,
      exchangeRate: input.exchangeRate ?? 1,
      nextDueDate: input.startDate,
    },
    db
  );
}
