import type { DbClient } from "@capital/server/lib/prisma";
import type { Budget, BudgetPeriod, Category } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { getEffectiveBudgetsForMonth, normalizeToMonthStart } from "../lib/effective-budgets";

export interface BudgetInput {
  entityId?: string | null;
  categoryId: string;
  amount: number;
  currency?: string;
  period?: BudgetPeriod;
  /** YYYY-MM-DD or YYYY-MM; normalized to the first of the month. */
  effectiveFrom: string;
  rollover?: boolean;
}

async function assertBudgetTargets(userId: string, input: { entityId?: string | null; categoryId?: string }, db: DbClient) {
  if (input.entityId) {
    const entity = await db.entity.findFirst({ where: { id: input.entityId, userId } });
    if (!entity) throw notFound("Entity", "entity.not_found");
  }
  if (input.categoryId) {
    const category = await db.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!category) throw notFound("Category", "category.not_found");
    if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived`, 422, { code: "category.archived", params: { name: category.name } });
  }
}

export interface BudgetWriteOptions {
  /** Mutation records are appended here instead of a new undo batch when given. */
  collect?: MutationRecordInput[];
}

function effectiveDate(value: string) {
  return normalizeToMonthStart(parseLocalDate(/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value));
}

/** Creates a budget, or reactivates an inactive one starting in the same month; one undo batch either way. */
export async function createBudget(userId: string, input: BudgetInput, db: DbClient, opts: BudgetWriteOptions = {}) {
  if (input.amount < 0) throw new LedgerError("Budget amount must be non-negative", 422, { code: "budget.negative_amount" });
  return inTransaction(db, async (tx) => {
    await assertBudgetTargets(userId, input, tx);
    const effectiveFrom = effectiveDate(input.effectiveFrom);
    const period = input.period ?? "monthly";
    const records: MutationRecordInput[] = opts.collect ?? [];
    // Same key as the unique index: a monthly and a yearly budget may start in the same month.
    const clash = await tx.budget.findFirst({
      where: { userId, entityId: input.entityId ?? null, categoryId: input.categoryId, period, effectiveFrom },
    });
    if (clash?.isActive) throw new LedgerError("A budget for this category already starts in that month; update it instead", 409, { code: "budget.clash" });
    let budget;
    if (clash) {
      budget = await tx.budget.update({
        where: { id: clash.id },
        data: { amount: input.amount, ...(input.currency && { currency: input.currency }), ...(input.rollover !== undefined && { rollover: input.rollover }), isActive: true },
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
        },
        include: { category: true },
      });
      records.push({ model: "Budget", recordId: budget.id, before: null, after: snapshot(withoutCategory(budget)) });
    }
    const batchId = opts.collect ? null : await recordMutation(tx, userId, clash ? "update" : "create", budget.category.name, records);
    return { ...budget, batchId };
  });
}

export async function updateBudget(
  userId: string,
  budgetId: string,
  patch: Partial<Omit<BudgetInput, "entityId" | "categoryId">> & { isActive?: boolean },
  db: DbClient,
  opts: BudgetWriteOptions = {}
) {
  return inTransaction(db, async (tx) => {
    const budget = await tx.budget.findFirst({ where: { id: budgetId, userId } });
    if (!budget) throw notFound("Budget", "budget.not_found");
    if (patch.amount !== undefined && patch.amount < 0) throw new LedgerError("Budget amount must be non-negative", 422, { code: "budget.negative_amount" });
    const effectiveFrom = patch.effectiveFrom ? effectiveDate(patch.effectiveFrom) : undefined;
    const period = patch.period ?? budget.period;
    const start = effectiveFrom ?? budget.effectiveFrom;
    // Moving the start month or switching the period changes the unique key (entity, category, period, effectiveFrom).
    if (effectiveFrom || period !== budget.period) {
      const clash = await tx.budget.findFirst({
        where: { userId, entityId: budget.entityId, categoryId: budget.categoryId, period, effectiveFrom: start, id: { not: budgetId } },
      });
      if (clash) throw new LedgerError("Another budget for this category already starts in that month", 409, { code: "budget.clash" });
    }
    const updated = await tx.budget.update({
      where: { id: budgetId },
      data: {
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.period !== undefined && { period: patch.period }),
        ...(patch.rollover !== undefined && { rollover: patch.rollover }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...((effectiveFrom || period !== budget.period) && {
          effectiveFrom: start,
          year: start.getUTCFullYear(),
          month: period === "monthly" ? start.getUTCMonth() + 1 : null,
        }),
      },
      include: { category: true },
    });
    const records: MutationRecordInput[] = opts.collect ?? [];
    records.push({ model: "Budget", recordId: budget.id, before: snapshot(budget), after: snapshot(withoutCategory(updated)) });
    const batchId = opts.collect ? null : await recordMutation(tx, userId, patch.isActive === false ? "delete" : "update", updated.category.name, records);
    return { ...updated, batchId };
  });
}

/** Soft delete (isActive = false), like the MCP tool always did; undoable like any update. */
export async function deactivateBudget(userId: string, budgetId: string, db: DbClient, opts: BudgetWriteOptions = {}) {
  return updateBudget(userId, budgetId, { isActive: false }, db, opts);
}

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
  };
}
