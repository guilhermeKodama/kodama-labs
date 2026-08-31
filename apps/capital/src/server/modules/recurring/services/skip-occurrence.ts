import type { PrismaClient } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { getNextOccurrence } from "@capital/server/lib/recurrence";
import { fetchRecurringById } from "../data/queries/fetch-recurring";

/**
 * Mark the current occurrence as concluded WITHOUT creating a Transaction —
 * unlike Mark as Paid / Registrar Pagamento. Advances nextDueDate the same
 * way, which is what stops the reminder cron's daily overdue nag (it keys
 * dispatches off nextDueDate, so moving it retires every pending nag for
 * this occurrence and starts a fresh key space for the next one).
 *
 * Use case: a reminder-mode entry that doesn't need a booked transaction this
 * cycle (e.g. a bill that turned out to be waived, or tracked elsewhere) but
 * whose recurrence should still roll forward instead of staying "overdue"
 * forever.
 */
export async function skipRecurringOccurrence(
  userId: string,
  id: string,
  db: PrismaClient
) {
  const recurring = await fetchRecurringById(userId, id, db);

  if (!recurring) {
    throw new Error("Recurring transaction not found");
  }

  if (!recurring.isActive) {
    throw new Error("Recurring transaction is not active");
  }

  const scheduledDate = toNoonUTC(recurring.nextDueDate);
  const nextDueDate = getNextOccurrence(scheduledDate, recurring.frequency);

  return db.recurringTransaction.update({
    where: { id },
    data: {
      nextDueDate,
      lastGeneratedDate: new Date(),
    },
  });
}
