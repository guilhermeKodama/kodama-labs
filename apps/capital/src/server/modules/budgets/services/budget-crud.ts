import type { DbClient } from "@capital/server/lib/prisma";
import type { Budget, BudgetPeriod, Category } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { getEffectiveBudgetsForMonth, normalizeToMonthStart, yearMonth } from "../lib/effective-budgets";

export interface BudgetInput {
  entityId?: string | null;
  categoryId: string;
  amount: number;
  currency?: string;
  period?: BudgetPeriod;
  /** YYYY-MM-DD or YYYY-MM; normalized to the first of the month. */
  effectiveFrom: string;
  rollover?: boolean;
  notes?: string | null;
}

export interface BudgetPatch {
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  effectiveFrom?: string;
  rollover?: boolean;
  isActive?: boolean;
  notes?: string | null;
  /**
   * YYYY-MM: the change applies from this month on and earlier months keep
   * their amount (a new version), unless it is the month the edited version
   * starts (then that version changes in place). Yearly budgets version by
   * year: any month of a year means its January.
   */
  applyFrom?: string;
}

export interface BudgetWriteOptions {
  /** Mutation records are appended here instead of a new undo batch when given. */
  collect?: MutationRecordInput[];
}

export interface BudgetUpdateOptions extends BudgetWriteOptions {
  /**
   * "in_place" changes the given version's row, rewriting every month it
   * covers (the MCP update_budget contract). "version" needs `applyFrom`.
   * Default: "version" when the patch has applyFrom, else "in_place".
   */
  mode?: "in_place" | "version";
}

async function assertBudgetTargets(userId: string, input: { entityId?: string | null; categoryId?: string }, db: DbClient) {
  if (input.entityId) {
    const entity = await db.entity.findFirst({ where: { id: input.entityId, userId } });
    if (!entity) throw notFound("Entity", "entity.not_found");
  }
  let category: Category | null = null;
  if (input.categoryId) {
    category = await db.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!category) throw notFound("Category", "category.not_found");
    if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived`, 422, { code: "category.archived", params: { name: category.name } });
  }
  return category;
}

function effectiveDate(value: string) {
  return normalizeToMonthStart(parseLocalDate(/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value));
}

/** The month a version of a budget with this period starts: the month itself, or January for yearly budgets. */
function versionStart(period: BudgetPeriod, value: string) {
  const month = effectiveDate(value);
  return period === "yearly" ? new Date(Date.UTC(month.getUTCFullYear(), 0, 1, 12)) : month;
}

const monthRange = (month: Date) => ({
  gte: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)),
  lt: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)),
});

type Chain = Pick<Budget, "userId" | "entityId" | "categoryId" | "period">;

/** The row of a chain starting in a month (any time of day: legacy rows start at 00:00 UTC). */
function rowAtMonth(db: DbClient, chain: Chain, month: Date) {
  return db.budget.findFirst({
    where: { userId: chain.userId, entityId: chain.entityId, categoryId: chain.categoryId, period: chain.period, effectiveFrom: monthRange(month) },
  });
}

const negativeAmount = () => new LedgerError("Budget amount must be non-negative", 422, { code: "budget.negative_amount" });

/** An active budget already starts in that month. `category` is the name the UI toast shows. */
function budgetClash(category: string) {
  return new LedgerError(`A budget for "${category}" already starts in that month; update it instead`, 409, { code: "budget.clash", params: { category } });
}

/**
 * Creates a budget (a chain's version from effectiveFrom on), or revives an
 * inactive row or a tombstone starting in the same month; one undo batch
 * either way.
 */
export async function createBudget(userId: string, input: BudgetInput, db: DbClient, opts: BudgetWriteOptions = {}) {
  if (input.amount < 0) throw negativeAmount();
  return inTransaction(db, async (tx) => {
    const category = await assertBudgetTargets(userId, input, tx);
    const effectiveFrom = effectiveDate(input.effectiveFrom);
    const period = input.period ?? "monthly";
    const records: MutationRecordInput[] = opts.collect ?? [];
    // Same key as the unique index: a monthly and a yearly budget may start in the same month.
    const clash = await rowAtMonth(tx, { userId, entityId: input.entityId ?? null, categoryId: input.categoryId, period }, effectiveFrom);
    if (clash?.isActive && !clash.isTombstone) throw budgetClash(category?.name ?? "");
    let budget;
    if (clash) {
      budget = await tx.budget.update({
        where: { id: clash.id },
        data: {
          amount: input.amount,
          ...(input.currency && { currency: input.currency }),
          ...(input.rollover !== undefined && { rollover: input.rollover }),
          ...(input.notes !== undefined && { notes: input.notes }),
          isActive: true,
          isTombstone: false,
        },
        include: { category: true },
      });
      records.push({ model: "Budget", recordId: clash.id, before: snapshot(clash), after: snapshot(withoutCategory(budget)) });
    } else {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
      budget = await tx.budget.create({
        data: {
          userId,
          entityId: input.entityId ?? null,
          categoryId: input.categoryId,
          amount: input.amount,
          currency: input.currency ?? user.baseCurrency,
          period,
          year: effectiveFrom.getUTCFullYear(),
          month: period === "monthly" ? effectiveFrom.getUTCMonth() + 1 : null,
          effectiveFrom,
          rollover: input.rollover ?? false,
          notes: input.notes ?? null,
        },
        include: { category: true },
      });
      records.push({ model: "Budget", recordId: budget.id, before: null, after: snapshot(withoutCategory(budget)) });
    }
    const batchId = opts.collect ? null : await recordMutation(tx, userId, clash ? "update" : "create", budget.category.name, records);
    return { ...budget, batchId };
  });
}

/**
 * Changes a budget. In place by default (the row and every month it covers);
 * with `applyFrom` (mode "version") the months before keep their amount and
 * the change becomes a new version of the chain from that month on. Returns
 * the row that now holds the change.
 */
export async function updateBudget(userId: string, budgetId: string, patch: BudgetPatch, db: DbClient, opts: BudgetUpdateOptions = {}) {
  const mode = opts.mode ?? (patch.applyFrom ? "version" : "in_place");
  if (patch.amount !== undefined && patch.amount < 0) throw negativeAmount();
  return inTransaction(db, async (tx) => {
    const budget = await tx.budget.findFirst({ where: { id: budgetId, userId } });
    if (!budget) throw notFound("Budget", "budget.not_found");
    const records: MutationRecordInput[] = opts.collect ?? [];
    const finish = async <T extends Budget & { category: Category }>(row: T, op: string) => {
      const batchId = opts.collect ? null : await recordMutation(tx, userId, op, row.category.name, records);
      return { ...row, batchId };
    };

    let change = patch;
    if (mode === "version" && patch.applyFrom) {
      const target = versionStart(budget.period, patch.applyFrom);
      const sameYear = budget.period === "yearly" && target.getUTCFullYear() === budget.effectiveFrom.getUTCFullYear();
      if (!sameYear && yearMonth(target) < yearMonth(budget.effectiveFrom)) {
        throw new LedgerError("The change can only apply from the month the budget starts", 422, { code: "budget.apply_before_start" });
      }
      if (!sameYear && yearMonth(target) !== yearMonth(budget.effectiveFrom)) {
        const values = {
          amount: patch.amount ?? budget.amount,
          currency: patch.currency ?? budget.currency,
          rollover: patch.rollover ?? budget.rollover,
          notes: patch.notes !== undefined ? patch.notes : budget.notes,
        };
        const existing = await rowAtMonth(tx, budget, target);
        if (existing) {
          const updated = await tx.budget.update({ where: { id: existing.id }, data: { ...values, isActive: true, isTombstone: false }, include: { category: true } });
          records.push({ model: "Budget", recordId: existing.id, before: snapshot(existing), after: snapshot(withoutCategory(updated)) });
          return finish(updated, "update");
        }
        const created = await tx.budget.create({
          data: {
            userId,
            entityId: budget.entityId,
            categoryId: budget.categoryId,
            period: budget.period,
            ...values,
            year: target.getUTCFullYear(),
            month: budget.period === "monthly" ? target.getUTCMonth() + 1 : null,
            effectiveFrom: target,
          },
          include: { category: true },
        });
        records.push({ model: "Budget", recordId: created.id, before: null, after: snapshot(withoutCategory(created)) });
        return finish(created, "update");
      }
      // The version starts in that month (or year): it changes in place, its start and period stay.
      change = { amount: patch.amount, currency: patch.currency, rollover: patch.rollover, notes: patch.notes };
    }

    const effectiveFrom = change.effectiveFrom ? effectiveDate(change.effectiveFrom) : undefined;
    const period = change.period ?? budget.period;
    const start = effectiveFrom ?? budget.effectiveFrom;
    // Moving the start month or switching the period changes the unique key (entity, category, period, effectiveFrom).
    if (effectiveFrom || period !== budget.period) {
      const clash = await tx.budget.findFirst({
        where: { userId, entityId: budget.entityId, categoryId: budget.categoryId, period, effectiveFrom: monthRange(start), id: { not: budgetId } },
      });
      if (clash) {
        const category = await tx.category.findFirst({ where: { id: budget.categoryId }, select: { name: true } });
        throw budgetClash(category?.name ?? "");
      }
    }
    const updated = await tx.budget.update({
      where: { id: budgetId },
      data: {
        ...(change.amount !== undefined && { amount: change.amount }),
        ...(change.currency !== undefined && { currency: change.currency }),
        ...(change.period !== undefined && { period: change.period }),
        ...(change.rollover !== undefined && { rollover: change.rollover }),
        ...(change.isActive !== undefined && { isActive: change.isActive }),
        ...(change.notes !== undefined && { notes: change.notes }),
        ...((effectiveFrom || period !== budget.period) && {
          effectiveFrom: start,
          year: start.getUTCFullYear(),
          month: period === "monthly" ? start.getUTCMonth() + 1 : null,
        }),
      },
      include: { category: true },
    });
    records.push({ model: "Budget", recordId: budget.id, before: snapshot(budget), after: snapshot(withoutCategory(updated)) });
    return finish(updated, change.isActive === false ? "delete" : "update");
  });
}

/** Soft delete of one version (isActive = false), like the MCP tool always did; undoable like any update. */
export async function deactivateBudget(userId: string, budgetId: string, db: DbClient, opts: BudgetWriteOptions = {}) {
  return updateBudget(userId, budgetId, { isActive: false }, db, { ...opts, mode: "in_place" });
}

async function loadChain(tx: DbClient, userId: string, budgetId: string) {
  const budget = await tx.budget.findFirst({ where: { id: budgetId, userId }, include: { category: true } });
  if (!budget) throw notFound("Budget", "budget.not_found");
  const chain = await tx.budget.findMany({
    where: { userId, entityId: budget.entityId, categoryId: budget.categoryId, period: budget.period },
    orderBy: { effectiveFrom: "asc" },
  });
  return { budget, chain };
}

async function stop(tx: DbClient, row: Budget, records: MutationRecordInput[]) {
  const updated = await tx.budget.update({ where: { id: row.id }, data: { isActive: false } });
  records.push({ model: "Budget", recordId: row.id, before: snapshot(row), after: snapshot(updated) });
}

/**
 * Ends a budget from a month on (YYYY-MM; yearly budgets from that year's
 * January): later versions stop and the months before keep their amounts.
 * When an older version would otherwise be in force again, a tombstone
 * version starting that month ends the chain. One undoable batch.
 */
export async function endBudgetFrom(userId: string, budgetId: string, from: string, db: DbClient, opts: BudgetWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const { budget, chain } = await loadChain(tx, userId, budgetId);
    const target = versionStart(budget.period, from);
    const records: MutationRecordInput[] = opts.collect ?? [];
    for (const row of chain) {
      if (row.isActive && yearMonth(row.effectiveFrom) > yearMonth(target)) await stop(tx, row, records);
    }
    const atTarget = chain.find((row) => yearMonth(row.effectiveFrom) === yearMonth(target));
    const earlier = chain.filter((row) => row.isActive && yearMonth(row.effectiveFrom) < yearMonth(target));
    const wouldResurface = earlier.length > 0 && !earlier[earlier.length - 1].isTombstone;
    if (wouldResurface) {
      if (atTarget && !(atTarget.isActive && atTarget.isTombstone)) {
        const updated = await tx.budget.update({ where: { id: atTarget.id }, data: { isActive: true, isTombstone: true } });
        records.push({ model: "Budget", recordId: atTarget.id, before: snapshot(atTarget), after: snapshot(updated) });
      } else if (!atTarget) {
        const tombstone = await tx.budget.create({
          data: {
            userId,
            entityId: budget.entityId,
            categoryId: budget.categoryId,
            period: budget.period,
            amount: 0,
            currency: budget.currency,
            year: target.getUTCFullYear(),
            month: budget.period === "monthly" ? target.getUTCMonth() + 1 : null,
            effectiveFrom: target,
            isTombstone: true,
          },
        });
        records.push({ model: "Budget", recordId: tombstone.id, before: null, after: snapshot(tombstone) });
      }
    } else if (atTarget?.isActive) {
      await stop(tx, atTarget, records);
    }
    const batchId = opts.collect || !records.length ? null : await recordMutation(tx, userId, "delete", budget.category.name, records);
    const row = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, include: { category: true } });
    return { ...row, batchId };
  });
}

/** Deletes every version of a budget (entity, category, period): every month, past ones included. One undoable batch. */
export async function deleteBudgetChain(userId: string, budgetId: string, db: DbClient, opts: BudgetWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const { budget, chain } = await loadChain(tx, userId, budgetId);
    const records: MutationRecordInput[] = opts.collect ?? [];
    for (const row of chain) if (row.isActive) await stop(tx, row, records);
    const batchId = opts.collect || !records.length ? null : await recordMutation(tx, userId, "delete", budget.category.name, records);
    const row = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, include: { category: true } });
    return { ...row, batchId };
  });
}

/** Active budget versions (tombstones left out), or the ones in force at a date. */
export async function listBudgets(
  userId: string,
  db: DbClient,
  filters: { entityId?: string | null; categoryId?: string; effectiveAt?: string } = {}
) {
  if (filters.effectiveAt) {
    const budgets = await getEffectiveBudgetsForMonth(db, userId, effectiveDate(filters.effectiveAt), {
      entityId: filters.entityId,
      categoryId: filters.categoryId,
    });
    const ids = budgets.map((b) => b.id);
    return db.budget.findMany({ where: { id: { in: ids } }, include: { category: true }, orderBy: { effectiveFrom: "desc" } });
  }
  return db.budget.findMany({
    where: {
      userId,
      isActive: true,
      isTombstone: false,
      ...(filters.entityId !== undefined && { entityId: filters.entityId }),
      ...(filters.categoryId && { categoryId: filters.categoryId }),
    },
    include: { category: true },
    orderBy: [{ categoryId: "asc" }, { effectiveFrom: "desc" }],
  });
}

/** The plain row of a budget loaded with its category (snapshots hold no relations). */
function withoutCategory<T extends { category: unknown }>(b: T): Omit<T, "category"> {
  const { category: _category, ...row } = b;
  void _category;
  return row;
}

export function serializeBudget(b: Budget & { category: Category }) {
  return {
    id: b.id,
    entityId: b.entityId,
    categoryId: b.categoryId,
    category: b.category.name,
    amount: toNumber(b.amount),
    currency: b.currency,
    period: b.period,
    effectiveFrom: b.effectiveFrom.toISOString().slice(0, 10),
    rollover: b.rollover,
    isActive: b.isActive,
    isTombstone: b.isTombstone,
    notes: b.notes,
  };
}
