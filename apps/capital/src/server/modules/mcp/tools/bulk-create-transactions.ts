import type { DbClient } from "@capital/server/lib/prisma";
import type { BulkCreateTransactionItem, BulkCreateResult } from "../lib/types";
import { insertTransaction } from "../../transactions/data/commands/insert-transaction";
import { fetchTransactions } from "../../transactions/data/queries/fetch-transactions";

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
  const batchKeys = new Set<string>(); // Track keys within this batch

  // Fetch all existing transactions for the user in the date range of the batch
  const minDate = new Date(
    Math.min(...items.map((item) => new Date(item.date).getTime()))
  );
  const maxDate = new Date(
    Math.max(...items.map((item) => new Date(item.date).getTime()))
  );

  const existingTransactions = await fetchTransactions(
    userId,
    {
      dateFrom: minDate,
      dateTo: maxDate,
    },
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
  for (const item of items) {
    const key = createDedupeKey(
      new Date(item.date),
      item.amount,
      item.description
    );

    // Check against existing transactions
    const existingId = existingMap.get(key);
    if (existingId) {
      duplicateMap.set(key, existingId);
      continue;
    }

    // Check against items already in this batch
    if (batchKeys.has(key)) {
      duplicateMap.set(key, "batch-duplicate");
      continue;
    }

    batchKeys.add(key);
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
  const result: BulkCreateResult = {
    created: [],
    duplicates: [],
    errors: [],
  };

  // Find duplicates first
  const duplicateMap = await findDuplicates(userId, items, db);

  for (const item of items) {
    const key = createDedupeKey(
      new Date(item.date),
      item.amount,
      item.description
    );

    // Check if this is a duplicate
    const existingId = duplicateMap.get(key);
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
          date: new Date(item.date),
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
