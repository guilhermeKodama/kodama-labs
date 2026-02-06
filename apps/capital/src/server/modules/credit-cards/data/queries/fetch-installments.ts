import type { DbClient } from "@capital/server/lib/prisma";

interface FetchInstallmentsFilters {
  creditCardId?: string;
  isActive?: boolean;
}

/**
 * Fetch installments filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters
 */
export async function fetchInstallments(
  userId: string,
  filters: FetchInstallmentsFilters,
  db: DbClient
) {
  return db.installment.findMany({
    where: {
      // MANDATORY: Always filter by user ownership
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      ...(filters.creditCardId && { creditCardId: filters.creditCardId }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    include: {
      creditCard: {
        select: {
          id: true,
          bankName: true,
          lastFourDigits: true,
          nickname: true,
          color: true,
        },
      },
      billTransaction: {
        select: {
          description: true,
          merchantName: true,
        },
      },
    },
    orderBy: { startDate: "desc" },
  });
}
