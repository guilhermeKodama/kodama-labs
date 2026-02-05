import type { DbClient } from "@capital/server/lib/prisma";
import type {
  TransferDirection,
  RecurrenceFrequency,
} from "@prisma/client";

interface UpdateRecurringTransferInput {
  direction?: TransferDirection;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  frequency?: RecurrenceFrequency;
  startDate?: Date;
  endDate?: Date | null;
  nextDueDate?: Date;
  lastGeneratedDate?: Date;
  isActive?: boolean;
}

export async function updateRecurringTransfer(
  id: string,
  input: UpdateRecurringTransferInput,
  db: DbClient
) {
  return db.recurringTransfer.update({
    where: { id },
    data: input,
  });
}
