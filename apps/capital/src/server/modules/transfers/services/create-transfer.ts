import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransferDirection } from "@prisma/client";
import { insertTransfer } from "../data/commands/insert-transfer";

interface CreateTransferInput {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  date: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
}

export async function createTransfer(
  userId: string,
  input: CreateTransferInput,
  db: DbClient
) {
  // Validate entity IDs match entity types
  if (input.fromEntityType === "business" && !input.fromBusinessId) {
    throw new Error("fromBusinessId is required for business entity type");
  }
  if (input.fromEntityType === "personal" && !input.fromPersonalAccountId) {
    throw new Error(
      "fromPersonalAccountId is required for personal entity type"
    );
  }
  if (input.toEntityType === "business" && !input.toBusinessId) {
    throw new Error("toBusinessId is required for business entity type");
  }
  if (input.toEntityType === "personal" && !input.toPersonalAccountId) {
    throw new Error("toPersonalAccountId is required for personal entity type");
  }

  // Data layer will verify ownership
  return insertTransfer(
    userId,
    {
      ...input,
      exchangeRate: input.exchangeRate ?? 1,
    },
    db
  );
}
