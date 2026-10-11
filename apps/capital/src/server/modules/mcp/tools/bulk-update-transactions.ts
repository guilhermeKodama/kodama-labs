import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { displayAmount } from "../../ledger/lib/money";
import { updateEntry, type InternalPatch } from "../../ledger/services/entries";
import { inTransaction, recordMutation, type MutationRecordInput } from "../../ledger/services/mutations";
import { categoryResolver, LEGACY_ENTRY_INCLUDE } from "../lib/ledger-adapter";
import { toPatch } from "./manage-transactions";

export interface BulkUpdateTransactionItem {
  id: string;
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  /** Cross-currency transfers: what arrived on the other leg, in its currency. */
  toAmount?: number;
  description?: string;
  category?: string;
  date?: string;
  isTaxDeductible?: boolean;
}

export interface BulkUpdateResult {
  updated: Array<{ id: string; description: string; category?: string; amount?: number }>;
  errors: Array<{ id: string; error: string }>;
  batchId?: string | null;
}

/**
 * All-or-nothing: every update is validated (ownership, categories) before
 * anything is written, then all of them are applied as one undoable batch.
 */
export async function bulkUpdateTransactions(userId: string, updates: BulkUpdateTransactionItem[], dryRun: boolean, db: DbClient): Promise<BulkUpdateResult> {
  const result: BulkUpdateResult = { updated: [], errors: [] };
  if (updates.length === 0) return result;

  const existing = await db.ledgerEntry.findMany({ where: { userId, deletedAt: null, id: { in: updates.map((u) => u.id) } }, include: LEGACY_ENTRY_INCLUDE });
  const byId = new Map(existing.map((e) => [e.id, e]));
  const resolver = await categoryResolver(userId, db);
  const errors: { id: string; error: string }[] = [];
  const patches = new Map<string, InternalPatch>();
  for (const u of updates) {
    const entry = byId.get(u.id);
    if (!entry) {
      errors.push({ id: u.id, error: "Transaction not found or access denied" });
      continue;
    }
    try {
      const { id, ...fields } = u;
      patches.set(id, toPatch(fields, entry, resolver));
    } catch (err) {
      errors.push({ id: u.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (errors.length > 0) {
    throw new Error(`Validation failed for ${errors.length} transaction(s):\n` + errors.map((e) => `  ${e.id}: ${e.error}`).join("\n"));
  }

  if (dryRun) {
    for (const u of updates) {
      const p = patches.get(u.id)!;
      const entry = byId.get(u.id)!;
      // The amount the caller sent is already the signed user-facing one; otherwise show the stored row.
      const amount = u.amount !== undefined ? u.amount : displayAmount(entry.kind, entry.amount);
      result.updated.push({ id: u.id, description: u.description ?? "(unchanged)", category: p.categoryId ? resolver.nameOf(p.categoryId) ?? undefined : u.category, amount });
    }
    return result;
  }

  try {
    result.batchId = await inTransaction(db, async (tx) => {
      const records: MutationRecordInput[] = [];
      for (const u of updates) {
        const { raw } = await updateEntry(userId, u.id, patches.get(u.id)!, tx, { collect: records });
        result.updated.push({ id: raw.id, description: raw.description, category: resolver.nameOf(raw.categoryId) ?? undefined, amount: displayAmount(raw.kind, raw.amount) });
      }
      return recordMutation(tx, userId, "update", `${updates.length} transactions (MCP)`, records);
    });
  } catch (error) {
    result.updated = [];
    result.errors.push({ id: "batch", error: error instanceof Error ? error.message : String(error) });
  }
  return result;
}
