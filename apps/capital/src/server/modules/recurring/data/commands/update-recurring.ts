import type { DbClient } from "@capital/server/lib/prisma";
import type {
  TransactionType,
  RecurrenceFrequency,
} from "@prisma/client";

interface UpdateRecurringData {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  frequency?: RecurrenceFrequency;
  startDate?: Date;
  endDate?: Date;
  nextDueDate?: Date;
  lastGeneratedDate?: Date;
  isActive?: boolean;
}

export async function updateRecurring(
  id: string,
  data: UpdateRecurringData,
  db: DbClient
) {
  return db.recurringTransaction.update({
    where: { id },
    data,
  });
}
