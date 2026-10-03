import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { fetchTransactionById } from "../../transactions/data/queries/fetch-transactions";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { matchCategoryName } from "../lib/category-validation";
import { fetchCategoriesByUserId } from "../../categories/data/queries/fetch-categories";

export interface BulkUpdateTransactionItem {
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

export interface BulkUpdateResult {
  updated: Array<{
    id: string;
    description: string;
    category?: string;
    amount?: number;
  }>;
  errors: Array<{
    id: string;
    error: string;
  }>;
}

/**
 * Validate all updates before applying them.
 */
async function validateUpdates(
  userId: string,
  updates: BulkUpdateTransactionItem[],
  db: DbClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Map<string, any>> {
  const errors: Array<{ id: string; error: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactionMap = new Map<string, any>();

  // First pass: verify ownership and fetch existing transactions
  for (const update of updates) {
    const existing = await fetchTransactionById(userId, update.id, db);
    if (!existing) {
      errors.push({
        id: update.id,
        error: "Transaction not found or access denied",
      });
      continue;
    }
    transactionMap.set(update.id, existing);
  }

  const categories = await fetchCategoriesByUserId(userId, undefined, db);

  // Second pass: validate categories against the list loaded once above
  for (const update of updates) {
    if (!transactionMap.has(update.id)) continue; // Already errored

    if (update.category) {
      const existing = transactionMap.get(update.id);
      const targetType = update.type ?? existing.type;
      const validation = matchCategoryName(update.category, categories, targetType);
      if (!validation.valid) {
        const suggestions = validation.suggestions.length > 0
          ? ` Did you mean: ${validation.suggestions.join(", ")}?`
          : "";
        const names = validation.validNames.length > 0
          ? ` Valid categories: ${validation.validNames.join(", ")}.`
          : "";
        errors.push({
          id: update.id,
          error: `Category '${update.category}' not found.${suggestions}${names}`,
        });
        transactionMap.delete(update.id); // Remove from valid set
      } else if (validation.canonicalName) {
        update.category = validation.canonicalName;
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Validation failed for ${errors.length} transaction(s):\n` +
      errors.map((e) => `  ${e.id}: ${e.error}`).join("\n")
    );
  }

  return transactionMap;
}

/**
 * Bulk update transactions with all-or-nothing semantics.
 * Validates everything first, then applies changes in a transaction.
 */
export async function bulkUpdateTransactions(
  userId: string,
  updates: BulkUpdateTransactionItem[],
  dryRun: boolean,
  db: DbClient
): Promise<BulkUpdateResult> {
  const result: BulkUpdateResult = {
    updated: [],
    errors: [],
  };

  if (updates.length === 0) {
    return result;
  }

  // Validate all updates first (throws on any error)
  await validateUpdates(userId, updates, db);

  // If dry-run, just return what would be updated
  if (dryRun) {
    for (const update of updates) {
      result.updated.push({
        id: update.id,
        description: update.description ?? "(unchanged)",
        category: update.category,
        amount: update.amount,
      });
    }
    return result;
  }

  // Apply all updates - we need to use the base prisma client for transactions
  // If db is already a transaction client, just execute directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executeUpdates = async (client: any) => {
    for (const update of updates) {
      const existing = await client.transaction.findFirst({
        where: {
          id: update.id,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      });

      if (!existing) {
        throw new Error(`Transaction ${update.id} not found during update`);
      }

      const updateData = {
        ...(update.type && { type: update.type }),
        ...(update.amount !== undefined && { amount: update.amount }),
        ...(update.currency && { currency: update.currency }),
        ...(update.exchangeRate !== undefined && { exchangeRate: update.exchangeRate }),
        ...(update.description && { description: update.description }),
        ...(update.category && { category: update.category }),
        ...(update.date && { date: parseLocalDate(update.date) }),
        ...(update.isTaxDeductible !== undefined && { isTaxDeductible: update.isTaxDeductible }),
      };

      const updated = await client.transaction.update({
        where: { id: update.id },
        data: updateData,
      });

      result.updated.push({
        id: updated.id,
        description: updated.description,
        category: updated.category,
        amount: updated.amount,
      });
    }
  };

  try {
    // Check if db has $transaction method (is PrismaClient, not TransactionClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (db as any).$transaction === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).$transaction(executeUpdates, { timeout: 30_000 });
    } else {
      // Already in a transaction, execute directly
      await executeUpdates(db);
    }
  } catch (error) {
    // If transaction fails, clear results and add error
    result.updated = [];
    result.errors.push({
      id: "batch",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
