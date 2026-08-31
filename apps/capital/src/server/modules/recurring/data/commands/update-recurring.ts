import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import type {
  TransactionType,
  RecurrenceFrequency,
} from "@/generated/prisma";
import type { RemindersConfig } from "@/lib/validations/reminders";

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
  autoGenerateTransaction?: boolean;
  // Omitted (undefined) = leave unchanged. There is deliberately no way to
  // null this out through the update path (see put-recurring.ts).
  reminders?: RemindersConfig;
}

/**
 * Update a recurring transaction, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transaction ID
 * @param data - The data to update
 * @throws If recurring transaction not found or not owned by user
 */
export async function updateRecurring(
  userId: string,
  id: string,
  data: UpdateRecurringData,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const recurring = await db.recurringTransaction.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!recurring) {
    throw new Error("Recurring transaction not found");
  }

  return db.recurringTransaction.update({
    where: { id },
    data: {
      ...data,
      reminders: data.reminders as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * System-level update for recurring transactions (used by cron job).
 * This bypasses user ownership check since it's for internal processing.
 */
export async function updateRecurringSystem(
  id: string,
  data: UpdateRecurringData,
  db: DbClient
) {
  return db.recurringTransaction.update({
    where: { id },
    data: {
      ...data,
      reminders: data.reminders as Prisma.InputJsonValue | undefined,
    },
  });
}
