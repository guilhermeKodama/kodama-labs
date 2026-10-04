import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { updateTransaction as updateTransactionCmd } from "../data/commands/update-transaction";
import { fetchTransactionById } from "../data/queries/fetch-transactions";
import { rejectArchivedAssignment } from "@capital/server/modules/mcp/lib/category-validation";

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
  if (input.category) {
    const existing = await fetchTransactionById(userId, id, db);
    if (existing) {
      await rejectArchivedAssignment(
        userId,
        input.category,
        input.type ?? existing.type,
        db,
        existing.category
      );
    }
  }

  // Data layer will verify ownership
  return updateTransactionCmd(userId, id, input, db);
}
