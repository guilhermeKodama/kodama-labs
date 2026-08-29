import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateBillInput {
  closingDate?: Date;
  dueDate?: Date;
}

/**
 * Update a bill's own closingDate/dueDate. These are stored per-bill (not
 * derived from CreditCard.closingDay/dueDay) precisely so a later correction
 * to the card's recurring day doesn't retroactively rewrite already-issued
 * bills - see CreditCard vs CreditCardBill in schema.prisma. This is the
 * only way to fix a bill that was created with a wrong date (e.g. an
 * AI-guessed closing/due day from a statement import).
 */
export async function updateBill(
  userId: string,
  billId: string,
  input: UpdateBillInput,
  db: DbClient
) {
  const bill = await db.creditCardBill.findFirst({
    where: {
      id: billId,
      creditCard: { OR: [{ business: { userId } }, { personalAccount: { userId } }] },
    },
    select: { id: true },
  });
  if (!bill) {
    throw new Error("Bill not found or access denied");
  }

  return db.creditCardBill.update({
    where: { id: billId },
    data: {
      ...(input.closingDate && { closingDate: input.closingDate }),
      ...(input.dueDate && { dueDate: input.dueDate }),
    },
  });
}
