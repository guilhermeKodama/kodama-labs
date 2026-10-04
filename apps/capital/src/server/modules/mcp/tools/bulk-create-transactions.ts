import type { TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import type { BulkCreateTransactionItem, BulkCreateResult } from "../lib/types";
import { insertTransaction } from "../../transactions/data/commands/insert-transaction";
import { fetchTransactions } from "../../transactions/data/queries/fetch-transactions";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { parseDateRangeFilter } from "../lib/date-helpers";
import { formatCategoryValidationError, matchCategoryName } from "../lib/category-validation";
import { fetchCategoriesByUserId } from "../../categories/data/queries/fetch-categories";

/**
 * Detect duplicates by matching date + amount + description
 * against existing transactions and within the batch itself.
 * 
 * This is the same deduplication strategy used for statement imports
 * to prevent re-importing the same dividend payments or transactions.
 */
async function findDuplicates(
  userId: string,
  items: BulkCreateTransactionItem[],
  db: DbClient
) {
  const duplicateMap = new Map<string, string>(); // key -> existing transaction ID
  const batchKeyIndices = new Map<string, number>(); // Track first occurrence index within this batch

  // Fetch all existing transactions for the user in the date range of the batch
  const minDateStr = items.reduce((min, item) => item.date < min ? item.date : min, items[0].date);
  const maxDateStr = items.reduce((max, item) => item.date > max ? item.date : max, items[0].date);
  
  const dateRange = parseDateRangeFilter(minDateStr, maxDateStr);

  const existingTransactions = await fetchTransactions(
    userId,
    dateRange,
    db
  );

  // Build a lookup map: date + amount + description -> transaction ID
  const existingMap = new Map<string, string>();
  for (const txn of existingTransactions) {
    const key = createDedupeKey(
      txn.date,
      txn.amount,
      txn.description
    );
    existingMap.set(key, txn.id);
  }

  // Check each item for duplicates
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = createDedupeKey(
      parseLocalDate(item.date),
      item.amount,
      item.description
    );

    // Check against existing transactions
    const existingId = existingMap.get(key);
    if (existingId) {
      duplicateMap.set(`${i}:${key}`, existingId);
      continue;
    }

    // Check against items already in this batch
    const firstIndex = batchKeyIndices.get(key);
    if (firstIndex !== undefined) {
      // This is a duplicate of an earlier item in the batch
      duplicateMap.set(`${i}:${key}`, "batch-duplicate");
      continue;
    }

    // Record this as the first occurrence of this key in the batch
    batchKeyIndices.set(key, i);
  }

  return duplicateMap;
}

function createDedupeKey(date: Date, amount: number, description: string): string {
  // Normalize to midnight UTC for date comparison
  const dateStr = date.toISOString().split("T")[0];
  // Round amount to 2 decimals to handle floating point
  const amountStr = amount.toFixed(2);
  // Normalize description: lowercase, trim whitespace
  const descStr = description.toLowerCase().trim();
  return `${dateStr}|${amountStr}|${descStr}`;
}

/**
 * Validate all categories in the batch before processing.
 */
async function validateCategories(
  userId: string,
  items: BulkCreateTransactionItem[],
  db: DbClient
): Promise<void> {
  const uniqueCategories = new Map<string, string>(); // category -> type
  for (const item of items) {
    const normalized = item.category.trim();
    uniqueCategories.set(normalized, item.type);
  }

  const categories = await fetchCategoriesByUserId(userId, undefined, db, {
    includeArchived: true,
  });
  const canonical = new Map<string, string>();
  const errors: string[] = [];
  for (const [category, type] of uniqueCategories) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validation = matchCategoryName(category, categories, type as any);
    if (!validation.valid) {
      errors.push(formatCategoryValidationError(category, type as TransactionType, validation));
    } else if (validation.canonicalName) {
      canonical.set(`${type}:${category}`, validation.canonicalName);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Category validation failed:\n${errors.join("\n")}`);
  }

  for (const item of items) {
    const key = `${item.type}:${item.category.trim()}`;
    const name = canonical.get(key);
    if (name) item.category = name;
  }
}

/**
 * Bulk create transactions with duplicate detection.
 * 
 * @param userId - The authenticated user ID
 * @param items - Array of transactions to create
 * @param dryRun - If true, simulate without writing to DB
 * @param db - Database client
 */
export async function bulkCreateTransactions(
  userId: string,
  items: BulkCreateTransactionItem[],
  dryRun: boolean,
  db: DbClient
): Promise<BulkCreateResult> {
  // Validate all categories first
  await validateCategories(userId, items, db);

  const result: BulkCreateResult = {
    created: [],
    duplicates: [],
    errors: [],
  };

  // Find duplicates first
  const duplicateMap = await findDuplicates(userId, items, db);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = createDedupeKey(
      parseLocalDate(item.date),
      item.amount,
      item.description
    );

    // Check if this is a duplicate
    const existingId = duplicateMap.get(`${i}:${key}`);
    if (existingId) {
      result.duplicates.push({
        description: item.description,
        amount: item.amount,
        date: item.date,
        existingId: existingId === "batch-duplicate" ? "within-batch" : existingId,
      });
      continue;
    }

    // Skip actual creation if dry-run
    if (dryRun) {
      result.created.push({
        id: "dry-run",
        description: item.description,
        amount: item.amount,
        date: item.date,
      });
      continue;
    }

    // Create the transaction
    try {
      const created = await insertTransaction(
        userId,
        {
          ...item,
          date: parseLocalDate(item.date),
          exchangeRate: item.exchangeRate ?? 1,
        },
        db
      );

      result.created.push({
        id: created.id,
        description: created.description,
        amount: created.amount,
        date: created.date.toISOString(),
      });
    } catch (error) {
      result.errors.push({
        item,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
