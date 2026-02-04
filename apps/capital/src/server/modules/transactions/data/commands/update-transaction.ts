import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";

interface UpdateTransactionData {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: Date;
  isTaxDeductible?: boolean;
}

export async function updateTransaction(
  id: string,
  data: UpdateTransactionData,
  db: DbClient
) {
  return db.transaction.update({
    where: { id },
    data,
  });
}
