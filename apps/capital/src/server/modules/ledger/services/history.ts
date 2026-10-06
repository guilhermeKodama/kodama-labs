import type { DbClient } from "@capital/server/lib/prisma";
import type { Import, LedgerKind, MutationBatch, MutationRecord } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { notFound } from "../lib/errors";
import { displayAmount } from "../lib/money";

/**
 * What happened to an entry, oldest first, for the "Histórico" of the edit
 * sheet: where it came from (an import, a recurrence, a copy), the rule that
 * chose its category, and every live (not undone) change of the undo log to
 * it or its transfer, with who made it (the batch source) and which fields
 * moved. The client turns these events into text.
 */

/** Columns the history reports; the rest (base amounts, statements, timestamps) follow from these. */
const TRACKED = ["description", "amount", "date", "categoryId", "accountId", "entityId", "notes", "isTaxDeductible", "kind", "currency", "exchangeRate"] as const;
export type HistoryField = (typeof TRACKED)[number] | "counterpartAccountId" | "direction";
export type HistoryValue = string | number | boolean | null;

export interface HistoryChange {
  field: HistoryField;
  before: HistoryValue;
  after: HistoryValue;
}

interface BatchRef {
  at: string;
  batchId: string;
  /** user | import | assistant | mcp | system */
  source: string;
  op: string;
}

export interface ImportRef {
  id: string;
  bankName: string | null;
  fileName: string | null;
  /** Upper-case file extension (OFX, CSV, PDF…), when the file name has one. */
  fileType: string | null;
  source: string;
  createdAt: string;
  revertedAt: string | null;
}

export type HistoryEvent =
  | (Omit<BatchRef, "batchId" | "source" | "op"> & {
      type: "created";
      batchId: string | null;
      source: string | null;
      op: string | null;
      import: ImportRef | null;
      recurringRule: { id: string; description: string; frequency: string; isActive: boolean } | null;
      installment: { n: number; total: number } | null;
      duplicatedFrom: string | null;
    })
  | {
      type: "categorized";
      /** When the rule assigned it; null when only the auto-categorized flag says so (AI or an older import). */
      at: string | null;
      by: "rule" | "auto";
      rule: { id: string; pattern: string; matchType: string } | null;
      categoryId: string | null;
    }
  | (BatchRef & { type: "updated"; changes: HistoryChange[] })
  | (BatchRef & { type: "deleted" | "restored" });

type Snap = Record<string, unknown>;

function fileType(fileName: string | null) {
  const ext = fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return ext ? ext.toUpperCase() : null;
}

function importRef(imp: Import | null): ImportRef | null {
  if (!imp) return null;
  return {
    id: imp.id,
    bankName: imp.bankName,
    fileName: imp.fileName,
    fileType: fileType(imp.fileName),
    source: imp.source,
    createdAt: imp.createdAt.toISOString(),
    revertedAt: imp.revertedAt?.toISOString() ?? null,
  };
}

/** A snapshot column as the client shows it: dates as YYYY-MM-DD, amounts as the magnitude the user typed. */
function valueOf(field: HistoryField, snap: Snap): HistoryValue {
  const v = snap[field === "counterpartAccountId" ? "accountId" : field];
  if (v === undefined || v === null) return null;
  if (field === "amount") return displayAmount(snap.kind as LedgerKind, v as string);
  if (field === "exchangeRate") return Number(v);
  if (field === "date") return typeof v === "string" ? formatDateOnly(new Date(v)) : null;
  return v as HistoryValue;
}

function diff(fields: readonly HistoryField[], before: Snap, after: Snap): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const field of fields) {
    const b = valueOf(field, before);
    const a = valueOf(field, after);
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field, before: b, after: a });
  }
  return out;
}

const asSnap = (v: unknown) => (v ?? null) as Snap | null;

export async function getEntryHistory(userId: string, entryId: string, db: DbClient) {
  const entry = await db.ledgerEntry.findFirst({
    where: { id: entryId, userId },
    include: {
      import: true,
      recurringRule: true,
      installmentPlan: { select: { totalInstallments: true } },
      categorizedByRule: { select: { id: true, pattern: true, matchType: true } },
      transferGroup: { include: { legs: { select: { id: true } }, import: true, recurringRule: true } },
    },
  });
  if (!entry) throw notFound("Transaction", "entry.not_found");

  const group = entry.transferGroup;
  const legIds = group ? group.legs.map((l) => l.id) : [entry.id];
  const records = await db.mutationRecord.findMany({
    where: {
      batch: { userId, undoneAt: null },
      OR: [{ model: "LedgerEntry", recordId: { in: legIds } }, ...(group ? [{ model: "TransferGroup", recordId: group.id }] : [])],
    },
    include: { batch: true },
    orderBy: [{ batch: { createdAt: "asc" } }, { id: "asc" }],
  });
  const batches = new Map<string, { batch: MutationBatch; records: MutationRecord[] }>();
  for (const { batch, ...record } of records) {
    const slot = batches.get(batch.id) ?? { batch, records: [] };
    slot.records.push(record);
    batches.set(batch.id, slot);
  }

  const imp = importRef(entry.import ?? group?.import ?? null);
  const rule = entry.recurringRule ?? group?.recurringRule ?? null;
  const metadata = (entry.metadata ?? {}) as { duplicatedFrom?: unknown };
  const origin = {
    import: imp,
    recurringRule: rule ? { id: rule.id, description: rule.description, frequency: rule.frequency, isActive: rule.isActive } : null,
    installment: entry.installmentNumber && entry.installmentPlan ? { n: entry.installmentNumber, total: entry.installmentPlan.totalInstallments } : null,
    duplicatedFrom: typeof metadata.duplicatedFrom === "string" ? metadata.duplicatedFrom : null,
  };

  const events: HistoryEvent[] = [];
  let created = false;
  let ruleSetAt: string | null = null;
  for (const { batch, records: recs } of batches.values()) {
    const ref: BatchRef = { at: batch.createdAt.toISOString(), batchId: batch.id, source: batch.source, op: batch.op };
    const legs = recs.filter((r) => r.model === "LedgerEntry");
    const own = legs.find((r) => r.recordId === entry.id) ?? null;
    const sibling = legs.find((r) => r.recordId !== entry.id) ?? null;
    const groupRec = recs.find((r) => r.model === "TransferGroup") ?? null;
    const ownAfter = asSnap(own?.after);
    const ownBefore = asSnap(own?.before);

    if (entry.categorizedByRuleId && !ruleSetAt && ownAfter?.categorizedByRuleId === entry.categorizedByRuleId && ownBefore?.categorizedByRuleId !== entry.categorizedByRuleId) {
      ruleSetAt = ref.at;
    }
    if (legs.some((r) => r.before === null)) {
      if (!created) events.push({ type: "created", ...ref, ...origin });
      created = true;
      continue;
    }
    const leg = own ?? sibling;
    const before = asSnap(leg?.before);
    const after = asSnap(leg?.after);
    if (before && after && (before.deletedAt === null) !== (after.deletedAt === null)) {
      events.push({ type: after.deletedAt === null ? "restored" : "deleted", ...ref });
      continue;
    }
    const changes = [
      ...(ownBefore && ownAfter ? diff(TRACKED, ownBefore, ownAfter) : []),
      ...(sibling?.before && sibling.after ? diff(["counterpartAccountId"], asSnap(sibling.before)!, asSnap(sibling.after)!) : []),
      ...(groupRec?.before && groupRec.after ? diff(["direction"], asSnap(groupRec.before)!, asSnap(groupRec.after)!) : []),
    ];
    // A sibling-only change of the shared fields (date, description, amount) shows as the transfer's.
    if (!own && sibling?.before && sibling.after) {
      for (const c of diff(["description", "amount", "date", "notes"], asSnap(sibling.before)!, asSnap(sibling.after)!)) changes.push(c);
    }
    if (changes.length) events.push({ type: "updated", ...ref, changes });
  }

  // Rows from before the undo log (or written without a batch) still say where they came from.
  if (!created) {
    events.unshift({
      type: "created",
      at: (group?.createdAt ?? entry.createdAt).toISOString(),
      batchId: null,
      source: imp ? "import" : null,
      op: null,
      ...origin,
    });
  }

  const createdAt = events.find((e) => e.type === "created")!.at;
  if (entry.categorizedByRuleId) {
    events.push({ type: "categorized", at: ruleSetAt ?? createdAt, by: "rule", rule: entry.categorizedByRule, categoryId: entry.categoryId });
  } else if (entry.isAutoCategorized && entry.categoryId) {
    events.push({ type: "categorized", at: null, by: "auto", rule: null, categoryId: entry.categoryId });
  }

  // Oldest first; an undated categorization sits right after the creation, and a categorization at creation follows it.
  const rank = (e: HistoryEvent) => (e.type === "created" ? 0 : e.type === "categorized" ? 1 : 2);
  events.sort((a, b) => (a.at ?? createdAt).localeCompare(b.at ?? createdAt) || rank(a) - rank(b));

  return { entryId: entry.id, transferGroupId: entry.transferGroupId, events };
}
export type EntryHistory = Awaited<ReturnType<typeof getEntryHistory>>;
