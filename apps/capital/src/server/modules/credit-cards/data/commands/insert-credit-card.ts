import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

interface CreateCreditCardData {
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color?: string;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

/**
 * Insert a new credit card after verifying user ownership of the target entity.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param data - The credit card data
 * @throws If the target business/personalAccount is not owned by the user
 */
export async function insertCreditCard(
  userId: string,
  data: CreateCreditCardData,
  db: DbClient
) {
  // MANDATORY: Verify user owns the target entity before creating credit card
  if (data.businessId) {
    const business = await db.business.findFirst({
      where: { id: data.businessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Business not found or access denied");
    }
  }

  if (data.personalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: data.personalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Personal account not found or access denied");
    }
  }

  return db.creditCard.create({
    data,
  });
}
