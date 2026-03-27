import type { DbClient } from "@capital/server/lib/prisma";
import type { BillStatus } from "@/generated/prisma";

interface CreateBillData {
  creditCardId: string;
  transactionId?: string;
  closingDate: Date;
  dueDate: Date;
  totalAmount: number;
  status?: BillStatus;
  csvFileName?: string;
}

/**
 * Insert a new credit card bill.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param data - The bill data
 * @throws If the credit card is not owned by the user
 */
export async function insertBill(
  userId: string,
  data: CreateBillData,
  db: DbClient
) {
  // MANDATORY: Verify ownership of the credit card
  const card = await db.creditCard.findFirst({
    where: {
      id: data.creditCardId,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!card) {
    throw new Error("Credit card not found or access denied");
  }

  return db.creditCardBill.create({
    data,
  });
}
