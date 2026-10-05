import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Budget } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { getEffectiveBudgetsForMonth } from "../lib/effective-budgets";

/**
 * Budget spend = expenses (kind expense, not transfer legs) by category and
 * entity on their effective date: card purchases count on their statement's
 * closing date, future installments are already real entries, so the
 * "committed" figure includes them without a separate projection.
 */

interface SpendRow {
  entity_id: string;
  category_id: string | null;
  spent: Prisma.Decimal;
  spent_to_date: Prisma.Decimal;
  n: number;
}

const monthBounds = (year: number, month: number) => ({
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
});

async function spendByCategory(db: DbClient, userId: string, from: Date, to: Date, asOf: Date) {
  return db.$queryRaw<SpendRow[]>`
    SELECT le."entityId" AS entity_id, le."categoryId" AS category_id,
           coalesce(-sum(le."amountBase"), 0) AS spent,
           coalesce(-sum(le."amountBase") FILTER (WHERE le."effectiveDate" <= ${asOf}), 0) AS spent_to_date,
           count(*)::int AS n
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
    GROUP BY 1, 2`;
}

function todayIn(timezone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = p.split("-").map(Number);
  return { y, m, d, date: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)) };
}

function spentFor(rows: SpendRow[], budget: Pick<Budget, "entityId" | "categoryId">, key: "spent" | "spent_to_date" = "spent") {
  return rows
    .filter((r) => r.category_id === budget.categoryId && (!budget.entityId || r.entity_id === budget.entityId))
    .reduce((s, r) => s + toNumber(r[key]), 0);
}

export async function monthOverview(userId: string, year: number, month: number, db: DbClient, opts: { entityId?: string } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, baseCurrency: true } });
  const today = todayIn(user.timezone);
  const { from, to } = monthBounds(year, month);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrent = today.y === year && today.m === month;
  const isPast = today.y * 100 + today.m > year * 100 + month;
  const daysElapsed = isCurrent ? today.d : isPast ? daysInMonth : 0;
  const asOf = isCurrent ? today.date : isPast ? to : new Date(from.getTime() - 1);

  const target = new Date(Date.UTC(year, month - 1, 1, 12));
  const all = await getEffectiveBudgetsForMonth(db, userId, target);
  const budgets = all.filter((b) => b.period === "monthly" && (!opts.entityId || !b.entityId || b.entityId === opts.entityId));
  const yearly = all.filter((b) => b.period === "yearly");
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true, color: true } });
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const spend = (await spendByCategory(db, userId, from, to, asOf)).filter((r) => !opts.entityId || r.entity_id === opts.entityId);
  const prevBounds = monthBounds(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const prevSpend = (await spendByCategory(db, userId, prevBounds.from, prevBounds.to, prevBounds.to)).filter((r) => !opts.entityId || r.entity_id === opts.entityId);
  const prevBudgets = await getEffectiveBudgetsForMonth(db, userId, new Date(Date.UTC(prevBounds.from.getUTCFullYear(), prevBounds.from.getUTCMonth(), 1, 12)));

  const rows = budgets.map((b) => {
    const amount = toNumber(b.amount);
    let carry = 0;
    if (b.rollover) {
      const prev = prevBudgets.find((p) => p.categoryId === b.categoryId && p.entityId === b.entityId && p.period === "monthly");
      if (prev) carry = Math.max(0, toNumber(prev.amount) - spentFor(prevSpend, prev));
    }
    const available = amount + carry;
    const committed = spentFor(spend, b);
    const spent = spentFor(spend, b, "spent_to_date");
    const dailySpendRate = daysElapsed > 0 ? spent / daysElapsed : 0;
    const allowedDailyRate = available / daysInMonth;
    const projectedTotal = daysElapsed > 0 ? Math.max(committed, spent + dailySpendRate * (daysInMonth - daysElapsed)) : committed;
    const percentUsed = available > 0 ? (spent / available) * 100 : 0;
    const pacePercent = (daysElapsed / daysInMonth) * 100;
    const status = spent > available ? "over" : percentUsed > pacePercent + 12 ? "ahead_of_pace" : "on_track";
    return {
      id: b.id,
      entityId: b.entityId,
      categoryId: b.categoryId,
      category: catName.get(b.categoryId) ?? "?",
      amount,
      carry: round(carry, 2),
      available: round(available, 2),
      spent: round(spent, 2),
      committed: round(committed, 2),
      remaining: round(available - spent, 2),
      percentUsed: round(percentUsed, 2),
      isOverBudget: spent > available,
      status,
      pace: {
        dailySpendRate: round(dailySpendRate, 2),
        allowedDailyRate: round(allowedDailyRate, 2),
        projectedTotal: round(projectedTotal, 2),
        isOverPace: dailySpendRate > allowedDailyRate,
        daysElapsed,
        daysRemaining: daysInMonth - daysElapsed,
        daysInPeriod: daysInMonth,
      },
    };
  });

  const budgetedKeys = new Set(budgets.map((b) => `${b.entityId ?? "*"}|${b.categoryId}`));
  const isBudgeted = (r: SpendRow) => budgetedKeys.has(`*|${r.category_id}`) || budgetedKeys.has(`${r.entity_id}|${r.category_id}`);
  const unbudgeted = spend
    .filter((r) => !isBudgeted(r))
    .map((r) => ({ entityId: r.entity_id, categoryId: r.category_id, category: r.category_id ? catName.get(r.category_id) ?? "?" : null, spent: round(toNumber(r.spent), 2), count: r.n }))
    .sort((a, b) => b.spent - a.spent);

  const monthOverMonth = rows.map((r) => {
    const previous = spentFor(prevSpend, r);
    const change = r.committed - previous;
    return {
      categoryId: r.categoryId,
      entityId: r.entityId,
      category: r.category,
      currentSpent: r.committed,
      previousSpent: round(previous, 2),
      changeAmount: round(change, 2),
      changePercent: round(previous > 0 ? (change / previous) * 100 : r.committed > 0 ? 100 : 0, 2),
    };
  });

  const insights = rows
    .map((r) => {
      const severity = r.isOverBudget ? "critical" : r.percentUsed >= 80 || r.status === "ahead_of_pace" ? "warning" : "good";
      const message = r.isOverBudget
        ? `${r.category}: acima do orçado em ${Math.abs(r.remaining).toFixed(0)}`
        : `${r.category}: ${r.percentUsed.toFixed(0)}% usado com ${r.pace.daysRemaining} dias restantes`;
      return { budgetId: r.id, category: r.category, severity, message, percentUsed: r.percentUsed, remaining: r.remaining };
    })
    .sort((a, b) => ({ critical: 0, warning: 1, good: 2 })[a.severity as "critical"] - ({ critical: 0, warning: 1, good: 2 })[b.severity as "critical"]);

  // Cumulative spend of budgeted categories per day vs. the ideal pace.
  const daily = await db.$queryRaw<{ day: number; spent: Prisma.Decimal }[]>`
    SELECT extract(day FROM le."effectiveDate")::int AS day, coalesce(-sum(le."amountBase"), 0) AS spent
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      AND le."categoryId" IN (${budgets.length ? Prisma.join(budgets.map((b) => b.categoryId)) : Prisma.sql`NULL`})
      ${opts.entityId ? Prisma.sql`AND le."entityId" = ${opts.entityId}` : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
  const totalBudget = rows.reduce((s, r) => s + r.available, 0);
  let acc = 0;
  const byDay = new Map(daily.map((d) => [d.day, toNumber(d.spent)]));
  const series = Array.from({ length: daysInMonth }, (_, i) => {
    acc += byDay.get(i + 1) ?? 0;
    return { day: i + 1, cumulative: round(acc, 2), ideal: round((totalBudget * (i + 1)) / daysInMonth, 2) };
  });

  // Fixed costs coming up: active recurring rules due within this month or the next 14 days.
  const horizon = new Date(Math.max(to.getTime(), today.date.getTime() + 14 * 86400_000));
  const upcoming = await db.recurringRule.findMany({
    where: { userId, isActive: true, nextDueDate: { lte: horizon }, ...(opts.entityId && { entityId: opts.entityId }) },
    orderBy: { nextDueDate: "asc" },
    take: 30,
  });

  const yearlyRows = await Promise.all(
    yearly.map(async (b) => {
      const yb = { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
      const s = await spendByCategory(db, userId, yb.from, yb.to, today.date);
      const spent = spentFor(s, b, "spent_to_date");
      return { id: b.id, entityId: b.entityId, categoryId: b.categoryId, category: catName.get(b.categoryId) ?? "?", amount: toNumber(b.amount), spent: round(spent, 2) };
    })
  );

  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  return {
    period: { year, month, daysElapsed, daysInMonth },
    summary: {
      totalBudget: round(totalBudget, 2),
      totalSpent: round(totalSpent, 2),
      totalCommitted: round(rows.reduce((s, r) => s + r.committed, 0), 2),
      totalRoom: round(totalBudget - totalSpent, 2),
      projectedTotal: round(rows.reduce((s, r) => s + r.pace.projectedTotal, 0), 2),
    },
    budgets: rows,
    yearlyBudgets: yearlyRows,
    insights,
    unbudgeted,
    monthOverMonth,
    series,
    upcoming: upcoming.map((r) => ({
      id: r.id,
      description: r.description,
      entityId: r.entityId,
      amount: toNumber(r.amount),
      currency: r.currency,
      nextDueDate: formatDateOnly(r.nextDueDate),
      mode: r.autoGenerate ? "auto" : "reminder",
      kind: r.kind,
    })),
  };
}

/**
 * Category x month matrix for a year. Months before the current one are
 * actuals; the current month is month-to-date; later months are projected
 * from the average of the last three complete months (committed entries such
 * as future installments are added on top).
 */
export async function yearOverview(userId: string, year: number, db: DbClient, opts: { entityId?: string } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const today = todayIn(user.timezone);
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const rows = await db.$queryRaw<{ category_id: string | null; m: number; spent: Prisma.Decimal; past: Prisma.Decimal }[]>`
    SELECT le."categoryId" AS category_id, extract(month FROM le."effectiveDate")::int AS m,
           coalesce(-sum(le."amountBase"), 0) AS spent,
           coalesce(-sum(le."amountBase") FILTER (WHERE le."effectiveDate" <= ${today.date}), 0) AS past
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      ${opts.entityId ? Prisma.sql`AND le."entityId" = ${opts.entityId}` : Prisma.empty}
    GROUP BY 1, 2`;
  const currentMonth = today.y === year ? today.m : today.y > year ? 13 : 0;
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true } });
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const budgetsByMonth = await Promise.all(
    Array.from({ length: 12 }, (_, i) => getEffectiveBudgetsForMonth(db, userId, new Date(Date.UTC(year, i, 1, 12))))
  );
  const categoryIds = new Set<string | null>([...rows.map((r) => r.category_id), ...budgetsByMonth.flat().map((b) => b.categoryId)]);

  const matrix = [...categoryIds].map((categoryId) => {
    const actual = Array.from({ length: 12 }, (_, i) => {
      const r = rows.find((x) => x.category_id === categoryId && x.m === i + 1);
      return r ? toNumber(i + 1 < currentMonth ? r.spent : r.past) : 0;
    });
    const committed = Array.from({ length: 12 }, (_, i) => toNumber(rows.find((x) => x.category_id === categoryId && x.m === i + 1)?.spent ?? 0));
    const complete = actual.slice(0, Math.max(0, Math.min(currentMonth - 1, 12)));
    const lastThree = complete.slice(-3);
    const projectionBase = lastThree.length ? lastThree.reduce((s, v) => s + v, 0) / lastThree.length : 0;
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const budget = budgetsByMonth[i].find((b) => b.categoryId === categoryId && b.period === "monthly" && (!opts.entityId || !b.entityId || b.entityId === opts.entityId));
      const isProjected = m > currentMonth;
      const value = isProjected ? Math.max(projectionBase, committed[i]) : actual[i];
      const budgetAmount = budget ? toNumber(budget.amount) : null;
      return {
        month: m,
        spent: round(value, 2),
        isProjected,
        isPartial: m === currentMonth,
        budget: budgetAmount,
        percentUsed: budgetAmount ? round((value / budgetAmount) * 100, 1) : null,
      };
    });
    const firstThree = complete.slice(0, 3);
    const trend =
      firstThree.length && lastThree.length && complete.length >= 6 && firstThree.reduce((s, v) => s + v, 0) > 0
        ? round(lastThree.reduce((s, v) => s + v, 0) / lastThree.length / (firstThree.reduce((s, v) => s + v, 0) / firstThree.length) - 1, 4)
        : null;
    const overMonths = months.filter((x) => !x.isProjected && x.budget !== null && x.spent > x.budget).length;
    return {
      categoryId,
      category: categoryId ? catName.get(categoryId) ?? "?" : null,
      months,
      yearTotal: round(months.reduce((s, x) => s + x.spent, 0), 2),
      trend,
      overMonths,
    };
  });
  matrix.sort((a, b) => b.yearTotal - a.yearTotal);

  const monthTotals = Array.from({ length: 12 }, (_, i) => round(matrix.reduce((s, r) => s + r.months[i].spent, 0), 2));
  const monthBudgets = budgetsByMonth.map((bs) => round(bs.filter((b) => b.period === "monthly").reduce((s, b) => s + toNumber(b.amount), 0), 2));
  const yearlyBudgets = budgetsByMonth[11].filter((b) => b.period === "yearly");

  return {
    year,
    currentMonth: Math.min(currentMonth, 12),
    categories: matrix,
    monthTotals,
    monthBudgets,
    summary: {
      spentToDate: round(monthTotals.slice(0, Math.min(currentMonth, 12)).reduce((s, v) => s + v, 0), 2),
      budgetToDate: round(monthBudgets.slice(0, Math.min(currentMonth, 12)).reduce((s, v) => s + v, 0), 2),
      projectedYear: round(monthTotals.reduce((s, v) => s + v, 0), 2),
      budgetYear: round(monthBudgets.reduce((s, v) => s + v, 0), 2),
      overBudgetMonths: matrix.reduce((s, r) => s + r.overMonths, 0),
    },
    insights: matrix
      .filter((r) => r.overMonths >= 3 || (r.trend !== null && Math.abs(r.trend) >= 0.12))
      .map((r) => ({
        categoryId: r.categoryId,
        category: r.category,
        kind: r.overMonths >= 3 ? "recurring_overrun" : r.trend! > 0 ? "growing" : "shrinking",
        overMonths: r.overMonths,
        trend: r.trend,
      })),
    yearlyBudgets: yearlyBudgets.map((b) => ({ id: b.id, categoryId: b.categoryId, category: catName.get(b.categoryId) ?? "?", amount: toNumber(b.amount) })),
  };
}
