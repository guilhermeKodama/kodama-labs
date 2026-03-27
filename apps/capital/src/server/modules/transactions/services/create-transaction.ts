import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@/generated/prisma";
import { insertTransaction } from "../data/commands/insert-transaction";

interface CreateTransactionInput {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description: string;
  category: string;
  date: Date;
  isTaxDeductible?: boolean;
  businessId?: string;
  personalAccountId?: string;
  recurringTransactionId?: string;
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
  db: DbClient
) {
  // Validate that the entity matches the type
  if (input.entityType === "business" && !input.businessId) {
    throw new Error("businessId is required for business entity type");
  }
  if (input.entityType === "personal" && !input.personalAccountId) {
    throw new Error(
      "personalAccountId is required for personal entity type"
    );
  }

  // Data layer will verify ownership
  return insertTransaction(
    userId,
    {
      ...input,
      exchangeRate: input.exchangeRate ?? 1,
    },
    db
  );
}
