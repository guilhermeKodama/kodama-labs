import type { DbClient } from "@capital/server/lib/prisma";
import type { BudgetPeriod } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
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
    if (!entity) throw notFound("Entity");
  }
  if (input.categoryId) {
    const category = await db.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!category) throw notFound("Category");
    if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived`, 422);
  }
}

function effectiveDate(value: string) {
  return normalizeToMonthStart(parseLocalDate(/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value));
}

export async function createBudget(userId: string, input: BudgetInput, db: DbClient) {
  if (input.amount < 0) throw new LedgerError("Budget amount must be non-negative", 422);
  await assertBudgetTargets(userId, input, db);
  const effectiveFrom = effectiveDate(input.effectiveFrom);
  const clash = await db.budget.findFirst({
    where: { userId, entityId: input.entityId ?? null, categoryId: input.categoryId, effectiveFrom },
  });
  if (clash?.isActive) throw new LedgerError("A budget for this category already starts in that month; update it instead", 409);
  if (clash) {
    return db.budget.update({
      where: { id: clash.id },
      data: { amount: input.amount, ...(input.currency && { currency: input.currency }), ...(input.rollover !== undefined && { rollover: input.rollover }), isActive: true },
      include: { category: true },
    });
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const period = input.period ?? "monthly";
  return db.budget.create({
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
}

export async function updateBudget(
  userId: string,
  budgetId: string,
  patch: Partial<Omit<BudgetInput, "entityId" | "categoryId">> & { isActive?: boolean },
  db: DbClient
) {
  const budget = await db.budget.findFirst({ where: { id: budgetId, userId } });
  if (!budget) throw notFound("Budget");
  if (patch.amount !== undefined && patch.amount < 0) throw new LedgerError("Budget amount must be non-negative", 422);
  const effectiveFrom = patch.effectiveFrom ? effectiveDate(patch.effectiveFrom) : undefined;
  if (effectiveFrom) {
    const clash = await db.budget.findFirst({
      where: { userId, entityId: budget.entityId, categoryId: budget.categoryId, effectiveFrom, id: { not: budgetId } },
    });
    if (clash) throw new LedgerError("Another budget for this category already starts in that month", 409);
  }
  return db.budget.update({
    where: { id: budgetId },
    data: {
      ...(patch.amount !== undefined && { amount: patch.amount }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.period !== undefined && { period: patch.period }),
      ...(patch.rollover !== undefined && { rollover: patch.rollover }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      ...(effectiveFrom && {
        effectiveFrom,
        year: effectiveFrom.getUTCFullYear(),
        month: (patch.period ?? budget.period) === "monthly" ? effectiveFrom.getUTCMonth() + 1 : null,
      }),
    },
    include: { category: true },
  });
}

/** Soft delete (isActive = false), like the MCP tool always did. */
export async function deactivateBudget(userId: string, budgetId: string, db: DbClient) {
  return updateBudget(userId, budgetId, { isActive: false }, db);
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

export function serializeBudget(b: Awaited<ReturnType<typeof createBudget>>) {
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
