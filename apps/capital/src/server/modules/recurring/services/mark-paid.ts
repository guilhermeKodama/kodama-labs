import type { PrismaClient } from "@/generated/prisma";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
} from "date-fns";
import type { RecurrenceFrequency } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

/**
 * Calculate the next occurrence date based on frequency
 */
function getNextOccurrence(
  currentDate: Date,
  frequency: RecurrenceFrequency
): Date {
  const date = toNoonUTC(currentDate);
  switch (frequency) {
    case "daily":
      return addDays(date, 1);
    case "weekly":
      return addWeeks(date, 1);
    case "monthly":
      return addMonths(date, 1);
    case "yearly":
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
}

export async function markRecurringAsPaid(
  userId: string,
  id: string,
  db: PrismaClient
) {
  // Verify ownership through data layer
  const recurring = await fetchRecurringById(userId, id, db);

  if (!recurring) {
    throw new Error("Recurring transaction not found");
  }

  if (!recurring.isActive) {
    throw new Error("Recurring transaction is not active");
  }

  const now = new Date();
  const transactionDate = toNoonUTC(recurring.nextDueDate);
  const nextDueDate = getNextOccurrence(transactionDate, recurring.frequency);

  // Use a transaction so the new Transaction + attachment carry-over + recurring
  // advancement either all commit or none do.
  const { transaction, updatedRecurring } = await db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        entityType: recurring.entityType,
        type: recurring.type,
        amount: recurring.amount,
        currency: recurring.currency,
        exchangeRate: recurring.exchangeRate,
        description: recurring.description,
        category: recurring.category,
        date: transactionDate,
        recurringTransactionId: recurring.id,
        businessId: recurring.businessId,
        personalAccountId: recurring.personalAccountId,
      },
    });

    // Move any pending BILL attachments from the recurring template onto the
    // freshly materialized transaction so the next iteration starts clean.
    await tx.attachment.updateMany({
      where: { recurringTransactionId: recurring.id, kind: "BILL" },
      data: { recurringTransactionId: null, transactionId: created.id },
    });

    const updated = await tx.recurringTransaction.update({
      where: { id },
      data: {
        nextDueDate,
        lastGeneratedDate: now,
      },
    });

    return { transaction: created, updatedRecurring: updated };
  });

  return { transaction, recurring: updatedRecurring };
}
