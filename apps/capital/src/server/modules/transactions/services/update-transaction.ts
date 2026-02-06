import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";
import { updateTransaction as updateTransactionCmd } from "../data/commands/update-transaction";

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
  userId: string,
  id: string,
  input: UpdateTransactionInput,
  db: DbClient
) {
  // Data layer will verify ownership
  return updateTransactionCmd(userId, id, input, db);
}
