import type { DbClient } from "@capital/server/lib/prisma";
import type { Budget } from "@/generated/prisma";

/** First day of a month at noon UTC (the project's effective-date convention). */
export function normalizeToMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0, 0));
}

const yearMonth = (d: Date) => d.getUTCFullYear() * 100 + d.getUTCMonth();

/**
 * Effective budgets for a month: per (entity, category, period) the most
 * recent active budget with effectiveFrom <= the month, compared by
 * year-month so legacy 00:00 UTC and current 12:00 UTC values both resolve.
 * Single source of truth for the v2 overview and the MCP budget tools.
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
  const latest = new Map<string, Budget>();
  for (const b of all) {
    const key = `${b.entityId ?? "*"}|${b.categoryId}|${b.period}`;
    const seen = latest.get(key);
    if (!seen || yearMonth(b.effectiveFrom) > yearMonth(seen.effectiveFrom)) latest.set(key, b);
  }
  return [...latest.values()];
}
