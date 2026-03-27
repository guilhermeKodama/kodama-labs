import { prisma } from "@capital/server/lib/prisma";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import type { RecurrenceFrequency } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { fetchRecurringTransferById } from "../data/queries/fetch-recurring-transfers";

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

export async function markRecurringTransferAsPaid(
  userId: string,
  recurringTransferId: string
) {
  // First verify ownership
  const recurring = await fetchRecurringTransferById(userId, recurringTransferId, prisma);

  if (!recurring) {
    throw new Error("Recurring transfer not found");
  }
  if (!recurring.isActive) {
    throw new Error("Cannot mark a paused recurring transfer as paid");
  }

  // Use a transaction to ensure both operations succeed or fail together
  const [createdTransfer, updatedRecurring] = await prisma.$transaction(
    async (tx) => {
      // Normalize the date to noon UTC
      const transferDate = toNoonUTC(recurring.nextDueDate);

      // Create the transfer
      const transfer = await tx.transfer.create({
        data: {
          fromEntityType: recurring.fromEntityType,
          toEntityType: recurring.toEntityType,
          direction: recurring.direction,
          amount: recurring.amount,
          currency: recurring.currency,
          exchangeRate: recurring.exchangeRate,
          description: recurring.description,
          date: transferDate,
          recurringTransferId: recurring.id,
          fromBusinessId: recurring.fromBusinessId,
          fromPersonalAccountId: recurring.fromPersonalAccountId,
          toBusinessId: recurring.toBusinessId,
          toPersonalAccountId: recurring.toPersonalAccountId,
        },
      });

      // Calculate the next due date
      const newNextDueDate = getNextOccurrence(
        recurring.nextDueDate,
        recurring.frequency
      );

      // Update the recurring transfer
      const updated = await tx.recurringTransfer.update({
        where: { id: recurringTransferId },
        data: {
          nextDueDate: newNextDueDate,
          lastGeneratedDate: new Date(),
        },
      });

      return [transfer, updated];
    }
  );

  return { createdTransfer, updatedRecurring };
}
