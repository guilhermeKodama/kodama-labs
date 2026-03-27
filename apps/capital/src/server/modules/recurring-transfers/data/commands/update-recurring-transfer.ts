import type { DbClient } from "@capital/server/lib/prisma";
import type {
  TransferDirection,
  RecurrenceFrequency,
} from "@/generated/prisma";

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

/**
 * Update a recurring transfer, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transfer ID
 * @param input - The data to update
 * @throws If recurring transfer not found or not owned by user
 */
export async function updateRecurringTransfer(
  userId: string,
  id: string,
  input: UpdateRecurringTransferInput,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const recurringTransfer = await db.recurringTransfer.findFirst({
    where: {
      id,
      OR: [
        { fromBusiness: { userId } },
        { fromPersonalAccount: { userId } },
        { toBusiness: { userId } },
        { toPersonalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!recurringTransfer) {
    throw new Error("Recurring transfer not found");
  }

  return db.recurringTransfer.update({
    where: { id },
    data: input,
  });
}

/**
 * System-level update for recurring transfers (used by cron job).
 * This bypasses user ownership check since it's for internal processing.
 */
export async function updateRecurringTransferSystem(
  id: string,
  input: UpdateRecurringTransferInput,
  db: DbClient
) {
  return db.recurringTransfer.update({
    where: { id },
    data: input,
  });
}
