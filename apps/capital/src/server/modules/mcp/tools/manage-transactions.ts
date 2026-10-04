import type { DbClient } from "@capital/server/lib/prisma";
import { updateTransactionService } from "../../transactions/services/update-transaction";
import { deleteTransactionService } from "../../transactions/services/delete-transaction";
import { fetchTransactionById } from "../../transactions/data/queries/fetch-transactions";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import type { TransactionType } from "@/generated/prisma";
import { formatCategoryValidationError, validateCategory } from "../lib/category-validation";

export interface UpdateTransactionParams {
  id: string;
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: string;
  isTaxDeductible?: boolean;
}

/**
 * Update a transaction by ID.
 */
export async function updateTransactionTool(
  userId: string,
  params: UpdateTransactionParams,
  db: DbClient
) {
  // Verify ownership first
  const existing = await fetchTransactionById(userId, params.id, db);
  if (!existing) {
    throw new Error("Transaction not found or access denied");
  }

  // Validate category if provided
  if (params.category) {
    const targetType = params.type ?? existing.type;
    const validation = await validateCategory(userId, params.category, targetType, db);
    const keepsCurrent =
      validation.archived &&
      validation.canonicalName != null &&
      existing.category.toLowerCase() === validation.canonicalName.toLowerCase();
    if (!validation.valid && !keepsCurrent) {
      throw new Error(formatCategoryValidationError(params.category, targetType, validation));
    }
    if (validation.canonicalName) {
      params.category = validation.canonicalName;
    }
  }

  const updates = {
    ...(params.type && { type: params.type }),
    ...(params.amount !== undefined && { amount: params.amount }),
    ...(params.currency && { currency: params.currency }),
    ...(params.exchangeRate !== undefined && { exchangeRate: params.exchangeRate }),
    ...(params.description && { description: params.description }),
    ...(params.category && { category: params.category }),
    ...(params.date && { date: parseLocalDate(params.date) }),
    ...(params.isTaxDeductible !== undefined && { isTaxDeductible: params.isTaxDeductible }),
  };

  return updateTransactionService(userId, params.id, updates, db);
}

/**
 * Delete a transaction by ID.
 */
export async function deleteTransactionTool(
  userId: string,
  id: string,
  db: DbClient
) {
  // Verify ownership first
  const existing = await fetchTransactionById(userId, id, db);
  if (!existing) {
    throw new Error("Transaction not found or access denied");
  }

  return deleteTransactionService(userId, id, db);
}
