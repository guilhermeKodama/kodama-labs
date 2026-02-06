import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateCreditCardData {
  bankName?: string;
  lastFourDigits?: string;
  nickname?: string;
  creditLimit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  currency?: string;
  isActive?: boolean;
}

/**
 * Update a credit card, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The credit card ID
 * @param data - The data to update
 * @throws If credit card not found or not owned by user
 */
export async function updateCreditCard(
  userId: string,
  id: string,
  data: UpdateCreditCardData,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const card = await db.creditCard.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!card) {
    throw new Error("Credit card not found");
  }

  return db.creditCard.update({
    where: { id },
    data,
  });
}
