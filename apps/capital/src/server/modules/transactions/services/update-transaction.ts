import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";
import { updateTransaction as updateTransactionCmd } from "../data/commands/update-transaction";
import { fetchTransactionById } from "../data/queries/fetch-transactions";

interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: Date;
  isTaxDeductible?: boolean;
}

export async function updateTransactionService(
  id: string,
  input: UpdateTransactionInput,
  db: DbClient
) {
  const existing = await fetchTransactionById(id, db);
  if (!existing) {
    throw new Error("Transaction not found");
  }

  return updateTransactionCmd(id, input, db);
}
