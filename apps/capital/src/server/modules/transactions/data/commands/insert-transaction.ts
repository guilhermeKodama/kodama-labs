import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@prisma/client";

interface CreateTransactionData {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number;
  description: string;
  category: string;
  date: Date;
  isTaxDeductible?: boolean;
  businessId?: string;
  personalAccountId?: string;
  recurringTransactionId?: string;
}

export async function insertTransaction(
  data: CreateTransactionData,
  db: DbClient
) {
  return db.transaction.create({
    data,
  });
}
