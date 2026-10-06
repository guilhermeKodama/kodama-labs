import { addDays } from "date-fns";
import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { deleteOperation } from "@capital/server/modules/investments/services/portfolio";
import { updateRecurringRule } from "@capital/server/modules/recurring/services/recurring-rules";
import type { DeleteEntryInput, DeleteScope } from "../contracts";
import { LedgerError, notFound } from "../lib/errors";
import { round, toNumber } from "../lib/money";
import { softDeleteEntries } from "./entries";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";

/**
 * Deleting one row of something larger. A recurring occurrence can go
 * alone, with the later ones (ending the recurrence), or with every
 * occurrence (deactivating it); an installment alone, with the later
 * parcels, or the whole purchase (closing the plan). An aporte that funded
 * an investment operation, or an operation's cash leg, can take the
 * operation with it (the position is recalculated). Every scope is one
 * undo batch.
 */

export type DeleteKind = "simple" | "recurring" | "installment" | "linked";

/** Rows as the table shows them: `count` rows (a transfer is one), summing `sum` in the base currency, dated `from`..`to`. */
export interface ScopeSummary {
  count: number;
  sum: number;
  from: string;
  to: string;
}

const OPERATION_INCLUDE = {
  holding: { select: { id: true, ticker: true, name: true, currency: true, account: { select: { id: true, name: true } } } },
} as const satisfies Prisma.InvestmentOperationInclude;

const SUBJECT_INCLUDE = {
  installmentPlan: true,
  recurringRule: true,
  investmentOperation: { include: OPERATION_INCLUDE },
  transferGroup: { include: { recurringRule: true, fundedOperation: { include: OPERATION_INCLUDE } } },
} as const satisfies Prisma.LedgerEntryInclude;

const ROW_SELECT = { id: true, transferGroupId: true, amountBase: true, date: true } as const satisfies Prisma.LedgerEntrySelect;
type ScopeRow = Prisma.LedgerEntryGetPayload<{ select: typeof ROW_SELECT }>;

async function loadSubject(userId: string, entryId: string, db: DbClient) {
  const entry = await db.ledgerEntry.findFirst({ where: { id: entryId, userId, deletedAt: null }, include: SUBJECT_INCLUDE });
  if (!entry) throw notFound("Transaction", "entry.not_found");
  const funded = entry.transferGroup?.fundedOperation ?? null;
  const operation = funded ?? entry.investmentOperation ?? null;
  const via: "funding" | "cash" | null = funded ? "funding" : entry.investmentOperation ? "cash" : null;
  const rule = entry.recurringRule ?? entry.transferGroup?.recurringRule ?? null;
  const plan = entry.installmentPlan;
  const kind: DeleteKind = plan ? "installment" : operation ? "linked" : rule ? "recurring" : "simple";
  return { entry, operation, via, rule, plan, kind };
}
type Subject = Awaited<ReturnType<typeof loadSubject>>;

/** The live rows a scope covers (both legs of each transfer). */
async function scopeRows(userId: string, s: Subject, scope: DeleteScope, db: DbClient): Promise<ScopeRow[]> {
  const live = { userId, deletedAt: null };
  if (scope === "one") {
    return s.entry.transferGroupId
      ? db.ledgerEntry.findMany({ where: { ...live, transferGroupId: s.entry.transferGroupId }, select: ROW_SELECT })
      : db.ledgerEntry.findMany({ where: { ...live, id: s.entry.id }, select: ROW_SELECT });
  }
  if (s.kind === "installment" && s.plan) {
    return db.ledgerEntry.findMany({
      where: { ...live, installmentPlanId: s.plan.id, ...(scope === "future" && { installmentNumber: { gte: s.entry.installmentNumber ?? 1 } }) },
      select: ROW_SELECT,
    });
  }
  if (s.kind === "recurring" && s.rule) {
    return db.ledgerEntry.findMany({
      where: {
        ...live,
        OR: [{ recurringRuleId: s.rule.id }, { transferGroup: { recurringRuleId: s.rule.id } }],
        ...(scope === "future" && { date: { gte: s.entry.date } }),
      },
      select: ROW_SELECT,
    });
  }
  throw new LedgerError("This transaction is not part of a recurrence or an installment plan, so only it can be deleted", 422, { code: "entry.scope_unavailable" });
}

/** One unit per table row: a transfer by its outflow (positive), anything else by its signed base amount. */
function units(rows: ScopeRow[]) {
  const byKey = new Map<string, { key: string; date: Date; amount: number }>();
  for (const r of rows) {
    const key = r.transferGroupId ?? r.id;
    const base = toNumber(r.amountBase);
    const amount = r.transferGroupId ? Math.max(byKey.get(key)?.amount ?? 0, Math.abs(base)) : base;
    byKey.set(key, { key, date: r.date, amount });
  }
  return [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key));
}

function summarize(rows: ScopeRow[]): ScopeSummary {
  const list = units(rows);
  return {
    count: list.length,
    sum: round(list.reduce((s, u) => s + u.amount, 0), 2),
    from: list.length ? formatDateOnly(list[0].date) : "",
    to: list.length ? formatDateOnly(list[list.length - 1].date) : "",
  };
}

function linkedOperationInfo(s: Subject) {
  const op = s.operation;
  if (!op) return null;
  return {
    id: op.id,
    /** funding: the entry is the aporte that paid for the operation; cash: the entry is the operation's own cash leg. */
    via: s.via!,
    type: op.type,
    quantity: op.quantity,
    pricePerUnit: op.pricePerUnit,
    totalAmount: op.totalAmount,
    fees: op.fees,
    date: formatDateOnly(op.date),
    holdingId: op.holding.id,
    ticker: op.holding.ticker,
    name: op.holding.name,
    currency: op.holding.currency,
    brokerAccountId: op.holding.account.id,
    brokerAccountName: op.holding.account.name,
  };
}

/**
 * What deleting this entry can take with it, for the delete dialog: the case,
 * which occurrence or parcel it is ("3/10"), and the rows and sum of each scope.
 */
export async function getDeleteOptions(userId: string, entryId: string, db: DbClient) {
  const s = await loadSubject(userId, entryId, db);
  const scopes: { one: ScopeSummary; future?: ScopeSummary; all?: ScopeSummary } = { one: summarize(await scopeRows(userId, s, "one", db)) };
  let occurrence: { n: number; total: number } | null = null;
  if (s.kind === "installment" || s.kind === "recurring") {
    const all = await scopeRows(userId, s, "all", db);
    scopes.future = summarize(await scopeRows(userId, s, "future", db));
    scopes.all = summarize(all);
    if (s.kind === "installment") {
      occurrence = { n: s.entry.installmentNumber ?? 1, total: s.plan!.totalInstallments };
    } else {
      const list = units(all);
      const key = s.entry.transferGroupId ?? s.entry.id;
      occurrence = { n: list.findIndex((u) => u.key === key) + 1, total: list.length };
    }
  }
  return {
    kind: s.kind,
    entryId: s.entry.id,
    transferGroupId: s.entry.transferGroupId,
    description: s.entry.description,
    date: formatDateOnly(s.entry.date),
    occurrence,
    scopes,
    recurringRule: s.rule
      ? {
          id: s.rule.id,
          description: s.rule.description,
          frequency: s.rule.frequency,
          isActive: s.rule.isActive,
          endDate: s.rule.endDate ? formatDateOnly(s.rule.endDate) : null,
        }
      : null,
    installmentPlan: s.plan
      ? {
          id: s.plan.id,
          description: s.plan.description,
          totalInstallments: s.plan.totalInstallments,
          totalAmount: toNumber(s.plan.totalAmount),
          installmentAmount: toNumber(s.plan.installmentAmount),
          isActive: s.plan.isActive,
        }
      : null,
    linkedOperation: linkedOperationInfo(s),
  };
}
export type DeleteOptions = Awaited<ReturnType<typeof getDeleteOptions>>;

/** Recurrence after "esta e as próximas": it ends the day before this occurrence, or stops if that is before it starts. */
async function endRecurrence(userId: string, s: Subject, scope: DeleteScope, tx: DbClient, records: MutationRecordInput[]) {
  const rule = s.rule!;
  if (!rule.isActive) return false;
  if (scope === "all") {
    await updateRecurringRule(userId, rule.id, { isActive: false }, tx, { collect: records });
    return true;
  }
  const end = formatDateOnly(addDays(s.entry.date, -1));
  if (end < formatDateOnly(rule.startDate)) {
    await updateRecurringRule(userId, rule.id, { isActive: false }, tx, { collect: records });
    return true;
  }
  if (rule.endDate && formatDateOnly(rule.endDate) <= end) return false;
  await updateRecurringRule(userId, rule.id, { endDate: end }, tx, { collect: records });
  return true;
}

async function closePlan(s: Subject, tx: DbClient, records: MutationRecordInput[]) {
  const plan = s.plan!;
  if (!plan.isActive) return false;
  const closed = await tx.installmentPlan.update({ where: { id: plan.id }, data: { isActive: false } });
  records.push({ model: "InstallmentPlan", recordId: plan.id, before: snapshot(plan), after: snapshot(closed) });
  return true;
}

/** Deletes the entry with the chosen scope, all in one undo batch. */
export async function deleteWithScope(userId: string, entryId: string, input: Partial<DeleteEntryInput>, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const s = await loadSubject(userId, entryId, tx);
    const scope = input.scope ?? "one";
    const rows = await scopeRows(userId, s, scope, tx);
    const summary = summarize(rows);
    const records: MutationRecordInput[] = [];

    let operationDeleted: string | null = null;
    if (s.kind === "linked" && s.operation && input.withLinkedOperation !== false) {
      // Trashes the operation's cash leg, and the aporte when that is what was deleted; the holding is recalculated.
      await deleteOperation(userId, s.operation.id, tx, { collect: records, withFunding: s.via === "funding" });
      operationDeleted = s.operation.id;
    }
    const left = await tx.ledgerEntry.findMany({ where: { id: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { id: true } });
    if (left.length) await softDeleteEntries(userId, left.map((r) => r.id), tx, { collect: records });

    const recurringRuleEnded = scope !== "one" && s.kind === "recurring" ? await endRecurrence(userId, s, scope, tx, records) : false;
    const installmentPlanClosed = scope !== "one" && s.kind === "installment" ? await closePlan(s, tx, records) : false;

    const batchId = await recordMutation(tx, userId, "delete", s.entry.description, records);
    return {
      batchId,
      kind: s.kind,
      scope,
      deleted: summary.count,
      sum: summary.sum,
      entryIds: rows.map((r) => r.id),
      operationDeleted,
      recurringRuleEnded,
      installmentPlanClosed,
    };
  });
}
