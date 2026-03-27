import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

interface FetchCreditCardsFilters {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  isActive?: boolean;
}

/**
 * Fetch credit cards filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters to narrow down results
 */
export async function fetchCreditCards(
  userId: string,
  filters: FetchCreditCardsFilters,
  db: DbClient
) {
  return db.creditCard.findMany({
    where: {
      // MANDATORY: Always filter by user ownership through business or personalAccount
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
      ...(filters.businessId && { businessId: filters.businessId }),
      ...(filters.personalAccountId && {
        personalAccountId: filters.personalAccountId,
      }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Fetch a single credit card by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The credit card ID
 * @returns The credit card if found and owned by user, null otherwise
 */
export async function fetchCreditCardById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.creditCard.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
  });
}
