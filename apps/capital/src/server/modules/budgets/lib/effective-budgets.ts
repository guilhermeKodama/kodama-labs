import type { DbClient } from "@capital/server/lib/prisma";
import type { Budget } from "@/generated/prisma";

/** First day of a month at noon UTC (the project's effective-date convention). */
export function normalizeToMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0, 0));
}

/** Year and month of a date as one comparable number (2026-09 → 202608, months 0-based). */
export const yearMonth = (d: Date) => d.getUTCFullYear() * 100 + d.getUTCMonth();

/** The versions of one budget share (entity, category, period): a chain ordered by effectiveFrom. */
export const chainKey = (b: Pick<Budget, "entityId" | "categoryId" | "period">) => `${b.entityId ?? "*"}|${b.categoryId}|${b.period}`;

type Versioned = Pick<Budget, "entityId" | "categoryId" | "period" | "effectiveFrom" | "isTombstone">;

/**
 * The versions in force in a month among active rows: per chain the most
 * recent with effectiveFrom <= the month, compared by year-month so legacy
 * 00:00 UTC and current 12:00 UTC values both resolve. A tombstone ends its
 * chain: when it is the latest version, the chain has no budget that month
 * (an older version does not come back).
 */
export function resolveEffective<B extends Versioned>(active: readonly B[], targetMonth: Date): B[] {
  const target = yearMonth(targetMonth);
  const latest = new Map<string, B>();
  for (const b of active) {
    if (yearMonth(b.effectiveFrom) > target) continue;
    const key = chainKey(b);
    const seen = latest.get(key);
    if (!seen || yearMonth(b.effectiveFrom) > yearMonth(seen.effectiveFrom)) latest.set(key, b);
  }
  return [...latest.values()].filter((b) => !b.isTombstone);
}

/**
 * Effective budgets for a month. Single source of truth for the v2
 * overview and the MCP budget tools.
 */
export async function getEffectiveBudgetsForMonth(
  db: DbClient,
  userId: string,
  targetMonth: Date,
  filters: { entityId?: string | null; categoryId?: string } = {}
): Promise<Budget[]> {
  const target = normalizeToMonthStart(targetMonth);
  const all = await db.budget.findMany({
    where: {
      userId,
      isActive: true,
      effectiveFrom: { lte: target },
      ...(filters.entityId !== undefined && { entityId: filters.entityId }),
      ...(filters.categoryId && { categoryId: filters.categoryId }),
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return resolveEffective(all, target);
}

/** The effective budgets of each month of a year (index 0 = January), from one query. */
export async function getEffectiveBudgetsByMonth(db: DbClient, userId: string, year: number): Promise<Budget[][]> {
  const december = new Date(Date.UTC(year, 11, 1, 12));
  const all = await db.budget.findMany({ where: { userId, isActive: true, effectiveFrom: { lte: december } }, orderBy: { effectiveFrom: "desc" } });
  return Array.from({ length: 12 }, (_, i) => resolveEffective(all, new Date(Date.UTC(year, i, 1, 12))));
}
