import type { DbClient } from "@capital/server/lib/prisma";

interface CreateBillTransactionData {
  billId: string;
  category: string;
  transactionDate: Date;
  description: string;
  merchantName?: string;
  amount: number;
  installmentNumber?: number;
  totalInstallments?: number;
  isAutoCategorized?: boolean;
}

/**
 * Insert multiple bill transactions at once.
 * @param data - Array of bill transaction data
 */
export async function insertBillTransactions(
  data: CreateBillTransactionData[],
  db: DbClient
) {
  return db.billTransaction.createMany({
    data,
  });
}

/**
 * Insert a single bill transaction.
 * @param data - The bill transaction data
 */
export async function insertBillTransaction(
  data: CreateBillTransactionData,
  db: DbClient
) {
  return db.billTransaction.create({
    data,
  });
}
