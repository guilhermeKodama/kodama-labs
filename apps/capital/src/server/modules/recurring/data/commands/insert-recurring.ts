import type { DbClient } from "@capital/server/lib/prisma";
import type {
  EntityType,
  TransactionType,
  RecurrenceFrequency,
} from "@prisma/client";

interface CreateRecurringData {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number;
  description: string;
  category: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  nextDueDate: Date;
  businessId?: string;
  personalAccountId?: string;
}

export async function insertRecurring(data: CreateRecurringData, db: DbClient) {
  return db.recurringTransaction.create({
    data,
  });
}
