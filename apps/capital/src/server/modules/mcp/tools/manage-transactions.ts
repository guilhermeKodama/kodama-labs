import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { parseLocalDate, formatDateOnly } from "@capital/server/lib/date-utils";
import { softDeleteEntries, updateEntry, type InternalPatch } from "../../ledger/services/entries";
import type { MutationRecordInput } from "../../ledger/services/mutations";
import { categoryResolver, LEGACY_ENTRY_INCLUDE, legacyType, toLegacyTransaction } from "../lib/ledger-adapter";

export interface UpdateTransactionParams {
  id: string;
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  /**
   * Cross-currency transfers: the inflow leg's amount in the destination
   * currency. The outflow stays unless `amount` is sent too (`amount` is then
   * the outflow). The foreign rate is derived from the two amounts.
   */
  toAmount?: number;
  description?: string;
  category?: string;
  date?: string;
  isTaxDeductible?: boolean;
}

type Resolver = Awaited<ReturnType<typeof categoryResolver>>;

export async function findOwnedEntry(userId: string, id: string, db: DbClient) {
  return db.ledgerEntry.findFirst({ where: { id, userId, deletedAt: null }, include: LEGACY_ENTRY_INCLUDE });
}

/** MCP update fields as a ledger patch; the category name is resolved against the entry's (new) type. */
export function toPatch(
  params: Omit<UpdateTransactionParams, "id">,
  existing: { kind: string; amount: unknown; categoryId: string | null },
  resolver: Resolver
): InternalPatch {
  const type = params.type ?? legacyType(existing as never);
  const patch: InternalPatch = {
    ...(params.type && existing.kind !== "transfer" && { kind: params.type }),
    ...(params.amount !== undefined && { amount: params.amount }),
    ...(params.currency && { currency: params.currency }),
    ...(params.exchangeRate !== undefined && { exchangeRate: params.exchangeRate }),
    ...(params.toAmount !== undefined && { toAmount: params.toAmount }),
    ...(params.description && { description: params.description }),
    ...(params.date && { date: formatDateOnly(parseLocalDate(params.date)) }),
    ...(params.isTaxDeductible !== undefined && { isTaxDeductible: params.isTaxDeductible }),
  };
  if (params.category) {
    const category = resolver.resolve(params.category, type, existing.categoryId);
    if (category.id !== existing.categoryId) patch.categoryId = category.id;
  }
  return patch;
}

/** Update a transaction by ID (one undoable batch). */
export async function updateTransactionTool(userId: string, params: UpdateTransactionParams, db: DbClient, opts: { collect?: MutationRecordInput[] } = {}) {
  const existing = await findOwnedEntry(userId, params.id, db);
  if (!existing) throw new Error("Transaction not found or access denied");
  const { id, ...fields } = params;
  const patch = toPatch(fields, existing, await categoryResolver(userId, db));
  await updateEntry(userId, id, patch, db, opts);
  const updated = await db.ledgerEntry.findUniqueOrThrow({ where: { id }, include: LEGACY_ENTRY_INCLUDE });
  return toLegacyTransaction(updated);
}

/** Move a transaction (and, for a transfer, its other leg) to the trash. */
export async function deleteTransactionTool(userId: string, id: string, db: DbClient) {
  const existing = await findOwnedEntry(userId, id, db);
  if (!existing) throw new Error("Transaction not found or access denied");
  return softDeleteEntries(userId, [id], db, { summary: existing.description });
}
