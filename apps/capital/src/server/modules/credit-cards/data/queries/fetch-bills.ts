import type { DbClient } from "@capital/server/lib/prisma";
import type { BillStatus } from "@prisma/client";

interface FetchBillsFilters {
  creditCardId?: string;
  status?: BillStatus;
}

/**
 * Fetch credit card bills filtered by user ownership.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param filters - Optional filters
 */
export async function fetchBills(
  userId: string,
  filters: FetchBillsFilters,
  db: DbClient
) {
  return db.creditCardBill.findMany({
    where: {
      // MANDATORY: Always filter by user ownership through credit card -> business/personalAccount
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      ...(filters.creditCardId && { creditCardId: filters.creditCardId }),
      ...(filters.status && { status: filters.status }),
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
      _count: {
        select: { billTransactions: true },
      },
    },
    orderBy: { dueDate: "desc" },
  });
}

/**
 * Fetch a single bill by ID, scoped to the authenticated user.
 */
export async function fetchBillById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.creditCardBill.findFirst({
    where: {
      id,
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    include: {
      creditCard: true,
      billTransactions: {
        orderBy: { transactionDate: "desc" },
      },
    },
  });
}
