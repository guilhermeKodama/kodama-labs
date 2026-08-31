import type { PrismaClient } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { getNextOccurrence } from "@capital/server/lib/recurrence";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

interface MarkPaidOverrides {
  /** The real amount paid. Reminder entries store an estimate; this is the truth. */
  amount?: number;
  /** The date the payment actually happened, if not the scheduled due date. */
  date?: Date;
}

export async function markRecurringAsPaid(
  userId: string,
  id: string,
  db: PrismaClient,
  overrides: MarkPaidOverrides = {}
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
  const scheduledDate = toNoonUTC(recurring.nextDueDate);
  const transactionDate = overrides.date
    ? toNoonUTC(overrides.date)
    : scheduledDate;
  const amount = overrides.amount ?? recurring.amount;
  // Advance from the SCHEDULED date, not the (possibly late) payment date —
  // paying a bill three days late must not drag the whole schedule forward.
  const nextDueDate = getNextOccurrence(scheduledDate, recurring.frequency);

  // Use a transaction so the new Transaction + attachment carry-over + recurring
  // advancement either all commit or none do.
  const { transaction, updatedRecurring } = await db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        entityType: recurring.entityType,
        type: recurring.type,
        amount,
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
