import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import type { BulkCreateTransactionItem, BulkCreateResult } from "../lib/types";
import { parseDateRangeFilter } from "../lib/date-helpers";
import { createEntry } from "../../ledger/services/entries";
import { getDefaultAccount, resolveLegacyEntity } from "../../ledger/services/entities";
import { inTransaction, recordMutation, type MutationRecordInput } from "../../ledger/services/mutations";
import { categoryResolver } from "../lib/ledger-adapter";

/** date + amount + description, the same key statement imports dedupe on. */
function dedupeKey(date: Date, amount: number, description: string): string {
  return `${date.toISOString().split("T")[0]}|${amount.toFixed(2)}|${description.toLowerCase().trim()}`;
}

/**
 * Bulk create transactions with duplicate detection against existing
 * entries (not transfers) and within the batch. Categories are validated
 * up front; the created entries form one undoable batch.
 */
export async function bulkCreateTransactions(userId: string, items: BulkCreateTransactionItem[], dryRun: boolean, db: DbClient): Promise<BulkCreateResult> {
  const result: BulkCreateResult = { created: [], duplicates: [], errors: [] };
  if (items.length === 0) return result;

  const resolver = await categoryResolver(userId, db);
  const errors: string[] = [];
  const categoryIds = items.map((item) => {
    try {
      return resolver.resolve(item.category.trim(), item.type).id;
    } catch (err) {
      errors.push((err as Error).message);
      return null;
    }
  });
  if (errors.length > 0) throw new Error(`Category validation failed:\n${[...new Set(errors)].join("\n")}`);

  const minDate = items.reduce((m, i) => (i.date < m ? i.date : m), items[0].date);
  const maxDate = items.reduce((m, i) => (i.date > m ? i.date : m), items[0].date);
  const range = parseDateRangeFilter(minDate, maxDate);
  const existing = await db.ledgerEntry.findMany({
    where: { userId, deletedAt: null, transferGroupId: null, date: { gte: range.dateFrom, lte: range.dateTo } },
    select: { id: true, date: true, amount: true, description: true },
  });
  const existingMap = new Map(existing.map((e) => [dedupeKey(e.date, Math.abs(Number(e.amount)), e.description), e.id]));
  const seen = new Set<string>();

  const toCreate: { item: BulkCreateTransactionItem; categoryId: string }[] = [];
  items.forEach((item, i) => {
    const key = dedupeKey(parseLocalDate(item.date), item.amount, item.description);
    const existingId = existingMap.get(key) ?? (seen.has(key) ? "within-batch" : undefined);
    seen.add(key);
    if (existingId) {
      result.duplicates.push({ description: item.description, amount: item.amount, date: item.date, existingId });
      return;
    }
    if (dryRun) result.created.push({ id: "dry-run", description: item.description, amount: item.amount, date: item.date });
    else toCreate.push({ item, categoryId: categoryIds[i]! });
  });
  if (dryRun || toCreate.length === 0) return result;

  await inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    for (const { item, categoryId } of toCreate) {
      try {
        const entity = await resolveLegacyEntity(userId, item, tx);
        const account = await getDefaultAccount(entity, tx);
        const created = await createEntry(
          userId,
          {
            kind: item.type === "income" ? "income" : "expense",
            accountId: account.id,
            amount: item.amount,
            currency: item.currency,
            exchangeRate: item.exchangeRate,
            description: item.description,
            date: formatDateOnly(parseLocalDate(item.date)),
            categoryId,
            isTaxDeductible: item.isTaxDeductible,
          },
          tx,
          { collect: records, kind: item.type, skipRules: true }
        );
        const row = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
        result.created.push({ id: row.id, description: row.description, amount: item.amount, date: row.date.toISOString() });
      } catch (error) {
        result.errors.push({ item, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (records.length) await recordMutation(tx, userId, "create", `${records.length} transactions (MCP)`, records);
  });
  return result;
}
