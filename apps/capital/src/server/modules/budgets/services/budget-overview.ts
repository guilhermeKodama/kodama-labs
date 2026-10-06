import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Budget } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { entityScopeSql, entityScopeWhere, inEntityScope } from "@capital/server/lib/entity-scope";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { budgetFor, excludedEntities, mean, slotKey, suggestedBudget } from "../lib/assign";
import { getEffectiveBudgetsByMonth, getEffectiveBudgetsForMonth } from "../lib/effective-budgets";
import { DAY_MS, todayIn, type UserToday } from "../lib/today";

/**
 * Budget spend = expenses (kind expense, not transfer legs) by category and
 * entity on their effective date: card purchases count on their statement's
 * closing date, future installments are already real entries, so the
 * "committed" figure includes them without a separate projection. Spend of
 * an entity goes to its own budget for the category, else to the category's
 * budget for every entity (lib/assign.ts), so nothing counts twice.
 *
 * A drill from a row to Transações selects the same entries with: kind in
 * [expense], transferDirection isNull, categoryId, the row's entity (or, for
 * a budget for every entity, the scope's entities minus excludeEntityIds),
 * dateField effectiveDate and the month's bounds (src/lib/budgets/drill.ts).
 *
 * Spend is in the base currency (amountBase), so every budget amount is
 * converted to base (the user's manual rates, as the ledger's amountBase)
 * before it is compared, summed or shown: `amount` is in base, while
 * `budgetAmount` and `currency` keep the budget as stored.
 */

/** A budget's amount in the base currency. */
const baseAmount = (fx: FxContext, b: Pick<Budget, "amount" | "currency">) => round(toNumber(b.amount) * fx.rateFor(b.currency), 2);

interface SpendSqlRow {
  entity_id: string;
  category_id: string | null;
  m: number;
  spent: Prisma.Decimal;
  spent_to_date: Prisma.Decimal;
  n: number;
}

interface Spend {
  entityId: string;
  categoryId: string | null;
  /** 1-12; 0 when the query was not grouped by month. */
  month: number;
  /** Every expense in the range (committed, future installments included). */
  spent: number;
  /** Expenses dated up to asOf. */
  spentToDate: number;
  count: number;
}

/** Entities an overview covers (resolveEntityScope); null or absent = all. */
export interface BudgetScope {
  entityIds?: string[] | null;
}

const monthBounds = (year: number, month: number) => ({
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
});

async function spendBySlot(db: DbClient, userId: string, range: { from: Date; to: Date }, asOf: Date, entityIds: string[] | null, byMonth = false): Promise<Spend[]> {
  const month = byMonth ? Prisma.sql`extract(month FROM le."effectiveDate")::int` : Prisma.sql`0`;
  const rows = await db.$queryRaw<SpendSqlRow[]>`
    SELECT le."entityId" AS entity_id, le."categoryId" AS category_id, ${month} AS m,
           coalesce(-sum(le."amountBase"), 0) AS spent,
           coalesce(-sum(le."amountBase") FILTER (WHERE le."effectiveDate" <= ${asOf}), 0) AS spent_to_date,
           count(*)::int AS n
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${range.from} AND ${range.to}
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    GROUP BY 1, 2, 3`;
  return rows.map((r) => ({ entityId: r.entity_id, categoryId: r.category_id, month: r.m, spent: toNumber(r.spent), spentToDate: toNumber(r.spent_to_date), count: r.n }));
}

/** A budget counts in a scope when it is for every entity (entityId null) or for one in the scope. */
const budgetInScope = (entityIds: string[] | null) => (b: Pick<Budget, "entityId">) => !b.entityId || inEntityScope(entityIds, b.entityId);

/** What spend of `list` counts against budget `b` among `budgets` (the scoped budgets of one period and month). */
function assigned(list: readonly Spend[], budgets: readonly Budget[], b: Budget, key: "spent" | "spentToDate") {
  return list.filter((s) => budgetFor(budgets, s.entityId, s.categoryId)?.id === b.id).reduce((sum, s) => sum + s[key], 0);
}

/** Display order of budget rows: every-entity budgets, then the personal entity, then businesses; categories by name. */
async function rowOrder(db: DbClient, userId: string) {
  const entities = await db.entity.findMany({ where: { userId }, select: { id: true, kind: true }, orderBy: { createdAt: "asc" } });
  const rank = new Map(entities.map((e, i) => [e.id, (e.kind === "personal" ? 1 : 2) * 1000 + i]));
  return <R extends { entityId: string | null; category: string | null }>(a: R, b: R) =>
    (a.entityId ? rank.get(a.entityId) ?? 9999 : 0) - (b.entityId ? rank.get(b.entityId) ?? 9999 : 0) ||
    (a.category ?? "").localeCompare(b.category ?? "", "pt-BR");
}

async function categoryNames(db: DbClient, userId: string) {
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true } });
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return (id: string | null) => (id ? names.get(id) ?? "?" : null);
}

/** How far through a year today is: 0 before it starts, 1 once it is over. */
function yearPaceOf(year: number, today: UserToday) {
  if (today.y < year) return 0;
  if (today.y > year) return 1;
  const start = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - start) / DAY_MS;
  // Day of the year (1 on Jan 1) over the year's length: 22/set/2026 is 265/365.
  return round(((Date.UTC(year, today.m - 1, today.d) - start) / DAY_MS + 1) / days, 4);
}

/** Yearly budgets with what they spent this year (to date and committed), from spend of the whole year. */
function yearlyRows(yearly: readonly Budget[], yearSpend: readonly Spend[], name: (id: string | null) => string | null, yearPace: number, entityIds: string[] | null, fx: FxContext) {
  return yearly.map((b) => {
    const amount = baseAmount(fx, b);
    const spent = assigned(yearSpend, yearly, b, "spentToDate");
    const committed = assigned(yearSpend, yearly, b, "spent");
    return {
      id: b.id,
      entityId: b.entityId,
      categoryId: b.categoryId,
      category: name(b.categoryId) ?? "?",
      amount,
      budgetAmount: toNumber(b.amount),
      currency: b.currency,
      spent: round(spent, 2),
      committed: round(committed, 2),
      percentUsed: round(amount > 0 ? (spent / amount) * 100 : 0, 2),
      yearPace,
      notes: b.notes,
      effectiveFrom: formatDateOnly(b.effectiveFrom),
      excludeEntityIds: excludedEntities(yearly, b).filter((id) => inEntityScope(entityIds, id)),
    };
  });
}

/** Complete months before the current one whose spend shapes the rest-of-month projection. */
const HISTORY_MONTHS = 3;

/**
 * What each (entity, category) usually spends after day `day` of a month,
 * from the HISTORY_MONTHS complete months before `year`/`month`: the
 * average over the months it had spend in. Rent paid on the 5th leaves
 * nothing for the rest of the month; groceries leave most of it.
 */
async function restOfMonthHistory(db: DbClient, userId: string, year: number, month: number, day: number, entityIds: string[] | null) {
  const from = new Date(Date.UTC(year, month - 1 - HISTORY_MONTHS, 1));
  const to = new Date(Date.UTC(year, month - 1, 1) - 1);
  const rows = await db.$queryRaw<{ entity_id: string; category_id: string | null; months: number; rest: Prisma.Decimal }[]>`
    SELECT le."entityId" AS entity_id, le."categoryId" AS category_id,
           count(DISTINCT date_trunc('month', le."effectiveDate"))::int AS months,
           coalesce(-sum(le."amountBase") FILTER (WHERE extract(day FROM le."effectiveDate") > ${day}), 0) AS rest
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ entityId: r.entity_id, categoryId: r.category_id, months: r.months, rest: toNumber(r.rest) }));
}

/** Days a past-due unpaid card statement still shows in Contas fixas. */
const OVERDUE_STATEMENT_DAYS = 31;
const UPCOMING_DAYS = 14;

/**
 * Contas fixas · próximos 14 dias: active non-income recurring rules due up
 * to 14 days from today (overdue reminders included) and unpaid card
 * statements due in that window (or overdue up to a month), with their
 * total, as mode "fatura".
 */
async function upcomingBills(db: DbClient, userId: string, today: UserToday, entityIds: string[] | null) {
  const horizon = new Date(today.end.getTime() + UPCOMING_DAYS * DAY_MS);
  const rules = await db.recurringRule.findMany({
    where: { userId, isActive: true, kind: { not: "income" }, nextDueDate: { lte: horizon }, ...entityScopeWhere(entityIds) },
    include: { account: { select: { name: true } } },
    orderBy: { nextDueDate: "asc" },
  });
  const statements = await db.cardStatement.findMany({
    where: {
      paymentGroupId: null,
      dueDate: { gte: new Date(today.start.getTime() - OVERDUE_STATEMENT_DAYS * DAY_MS), lte: horizon },
      account: { userId, type: "credit_card", archivedAt: null, ...entityScopeWhere(entityIds) },
    },
    include: { account: { select: { id: true, name: true, entityId: true, currency: true } } },
  });
  const totals = statements.length
    ? await db.ledgerEntry.groupBy({
        by: ["cardStatementId"],
        where: { cardStatementId: { in: statements.map((s) => s.id) }, deletedAt: null, transferGroupId: null },
        _sum: { amount: true },
      })
    : [];
  const purchases = new Map(totals.map((t) => [t.cardStatementId, -toNumber(t._sum.amount ?? 0)]));

  const items = [
    ...rules
      .filter((r) => !r.endDate || formatDateOnly(r.endDate) >= formatDateOnly(r.nextDueDate))
      .map((r) => {
        const dueDate = formatDateOnly(r.nextDueDate);
        return {
          id: r.id,
          source: "rule" as const,
          ruleId: r.id as string | null,
          statementId: null as string | null,
          month: null as string | null,
          description: r.description,
          entityId: r.entityId,
          accountId: r.accountId,
          accountName: r.account.name,
          amount: toNumber(r.amount),
          currency: r.currency,
          dueDate,
          nextDueDate: dueDate,
          mode: (r.autoGenerate ? "auto" : "reminder") as "auto" | "reminder" | "fatura",
          kind: r.kind as string,
          overdue: dueDate < today.iso,
        };
      }),
    ...statements.flatMap((s) => {
      const total = round(s.totalAmount !== null ? toNumber(s.totalAmount) : purchases.get(s.id) ?? 0, 2);
      if (!(total > 0) || !s.dueDate) return [];
      const dueDate = formatDateOnly(s.dueDate);
      return [
        {
          id: s.id,
          source: "statement" as const,
          ruleId: null,
          statementId: s.id,
          month: s.month,
          description: s.account.name,
          entityId: s.account.entityId,
          accountId: s.account.id,
          accountName: s.account.name,
          amount: total,
          currency: s.account.currency,
          dueDate,
          nextDueDate: dueDate,
          mode: "fatura" as const,
          kind: "card_bill",
          overdue: dueDate < today.iso,
        },
      ];
    }),
  ];
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, "pt-BR"));
}

export async function monthOverview(userId: string, year: number, month: number, db: DbClient, opts: BudgetScope = {}) {
  const entityIds = opts.entityIds ?? null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const today = todayIn(user.timezone);
  const fx = await loadFx(userId, db);
  const bounds = monthBounds(year, month);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrent = today.y === year && today.m === month;
  const isPast = today.y * 100 + today.m > year * 100 + month;
  const daysElapsed = isCurrent ? today.d : isPast ? daysInMonth : 0;
  const asOf = isCurrent ? today.end : isPast ? bounds.to : new Date(bounds.from.getTime() - 1);

  const inForce = (await getEffectiveBudgetsForMonth(db, userId, new Date(Date.UTC(year, month - 1, 1, 12)))).filter(budgetInScope(entityIds));
  const budgets = inForce.filter((b) => b.period === "monthly");
  const yearly = inForce.filter((b) => b.period === "yearly");
  const name = await categoryNames(db, userId);
  const order = await rowOrder(db, userId);

  const spend = await spendBySlot(db, userId, bounds, asOf, entityIds);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevBounds = monthBounds(prevYear, prevMonth);
  const prevSpend = await spendBySlot(db, userId, prevBounds, prevBounds.to, entityIds);
  const prevBudgets = (await getEffectiveBudgetsForMonth(db, userId, new Date(Date.UTC(prevYear, prevMonth - 1, 1, 12))))
    .filter(budgetInScope(entityIds))
    .filter((b) => b.period === "monthly");

  // The rest of a running month is projected from what each budget's spend usually does after today (else at today's daily rate).
  const history = isCurrent && daysElapsed < daysInMonth ? await restOfMonthHistory(db, userId, year, month, daysElapsed, entityIds) : [];

  const rows = budgets
    .map((b) => {
      const amount = baseAmount(fx, b);
      let carry = 0;
      if (b.rollover) {
        const prev = prevBudgets.find((p) => p.categoryId === b.categoryId && p.entityId === b.entityId);
        if (prev) carry = Math.max(0, baseAmount(fx, prev) - assigned(prevSpend, prevBudgets, prev, "spent"));
      }
      const available = amount + carry;
      const committed = assigned(spend, budgets, b, "spent");
      const spent = assigned(spend, budgets, b, "spentToDate");
      const dailySpendRate = daysElapsed > 0 ? spent / daysElapsed : 0;
      const allowedDailyRate = available / daysInMonth;
      const past = history.filter((h) => budgetFor(budgets, h.entityId, h.categoryId)?.id === b.id);
      const restOfMonth = past.length
        ? past.reduce((sum, h) => sum + h.rest / Math.max(1, h.months), 0)
        : dailySpendRate * (daysInMonth - daysElapsed);
      const projectedTotal = daysElapsed > 0 ? Math.max(committed, spent + restOfMonth) : committed;
      const percentUsed = available > 0 ? (spent / available) * 100 : 0;
      const pacePercent = (daysElapsed / daysInMonth) * 100;
      const status = spent > available ? "over" : percentUsed > pacePercent + 12 ? "ahead_of_pace" : "on_track";
      return {
        id: b.id,
        entityId: b.entityId,
        categoryId: b.categoryId,
        category: name(b.categoryId) ?? "?",
        amount,
        budgetAmount: toNumber(b.amount),
        currency: b.currency,
        effectiveFrom: formatDateOnly(b.effectiveFrom),
        rollover: b.rollover,
        notes: b.notes,
        excludeEntityIds: excludedEntities(budgets, b),
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
    })
    .sort(order);

  // Spend no budget covers: neither a monthly budget nor a yearly one.
  const unbudgeted = spend
    .filter((s) => !budgetFor(budgets, s.entityId, s.categoryId) && !budgetFor(yearly, s.entityId, s.categoryId))
    .map((s) => ({ entityId: s.entityId, categoryId: s.categoryId, category: name(s.categoryId), spent: round(s.spent, 2), count: s.count }))
    .sort((a, b) => b.spent - a.spent);

  const monthOverMonth = rows.map((r) => {
    const prev = prevBudgets.find((p) => p.categoryId === r.categoryId && p.entityId === r.entityId);
    const previous = prev ? assigned(prevSpend, prevBudgets, prev, "spent") : 0;
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

  const severityRank = { critical: 0, warning: 1, good: 2 } as const;
  const insights = rows
    .map((r) => ({
      budgetId: r.id,
      entityId: r.entityId,
      categoryId: r.categoryId,
      category: r.category,
      severity: (r.isOverBudget ? "critical" : r.percentUsed >= 80 || r.status === "ahead_of_pace" ? "warning" : "good") as keyof typeof severityRank,
      percentUsed: r.percentUsed,
      remaining: r.remaining,
      daysRemaining: r.pace.daysRemaining,
    }))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // Cumulative spend of the budgets per day up to today (the mockup's x axis ends today) vs. the ideal pace.
  const totalBudget = rows.reduce((s, r) => s + r.available, 0);
  const daily =
    daysElapsed > 0 && budgets.length
      ? await db.$queryRaw<{ day: number; entity_id: string; category_id: string | null; spent: Prisma.Decimal }[]>`
          SELECT extract(day FROM le."effectiveDate")::int AS day, le."entityId" AS entity_id, le."categoryId" AS category_id,
                 coalesce(-sum(le."amountBase"), 0) AS spent
          FROM ledger_entries le
          WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
            AND le."effectiveDate" BETWEEN ${bounds.from} AND ${asOf}
            AND le."categoryId" IN (${Prisma.join([...new Set(budgets.map((b) => b.categoryId))])})
            AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
          GROUP BY 1, 2, 3`
      : [];
  const byDay = new Map<number, number>();
  for (const d of daily) {
    if (budgetFor(budgets, d.entity_id, d.category_id)) byDay.set(d.day, (byDay.get(d.day) ?? 0) + toNumber(d.spent));
  }
  let acc = 0;
  const series = Array.from({ length: daysElapsed }, (_, i) => {
    acc += byDay.get(i + 1) ?? 0;
    return { day: i + 1, cumulative: round(acc, 2), ideal: round((totalBudget * (i + 1)) / daysInMonth, 2) };
  });

  const upcoming = await upcomingBills(db, userId, today, entityIds);

  const yearBounds = { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
  const yearSpend = yearly.length ? await spendBySlot(db, userId, yearBounds, new Date(Math.min(today.end.getTime(), yearBounds.to.getTime())), entityIds) : [];
  const yearlyBudgets = yearlyRows(yearly, yearSpend, name, yearPaceOf(year, today), entityIds, fx).sort(order);

  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  return {
    period: { year, month, daysElapsed, daysInMonth, today: today.iso, isCurrent, isPast },
    scope: { entityIds },
    summary: {
      totalBudget: round(totalBudget, 2),
      totalSpent: round(totalSpent, 2),
      totalCommitted: round(rows.reduce((s, r) => s + r.committed, 0), 2),
      totalRoom: round(totalBudget - totalSpent, 2),
      projectedTotal: round(rows.reduce((s, r) => s + r.pace.projectedTotal, 0), 2),
    },
    budgets: rows,
    yearlyBudgets,
    insights,
    unbudgeted,
    monthOverMonth,
    series,
    upcoming,
  };
}

export type MonthOverview = Awaited<ReturnType<typeof monthOverview>>;

export interface YearOverviewOptions extends BudgetScope {
  /** Only rows of monthly budgets (the heatmap); false adds a row per unbudgeted (entity, category). Default true. */
  onlyBudgeted?: boolean;
}

/** Order the year's insights are listed in, and the precedence when a row qualifies for several. */
export const INSIGHT_KINDS = ["overrun", "growth", "seasonal"] as const;
export type YearInsightKind = (typeof INSIGHT_KINDS)[number];

/** Months over budget for an "overrun" insight, growth for a "growth" one, and the peak-to-budget ratio for "seasonal". */
export const INSIGHT_RULES = { overrunMonths: 3, growth: 0.12, seasonalPeak: 1.4 } as const;

/**
 * Category x month matrix of a year, one row per monthly budget slot
 * (entity or every entity, category). Months before the current one are
 * actuals; the current month is month-to-date; later months are projected
 * from the average of the last three complete months (committed entries
 * such as future installments are added on top).
 */
export async function yearOverview(userId: string, year: number, db: DbClient, opts: YearOverviewOptions = {}) {
  const entityIds = opts.entityIds ?? null;
  const onlyBudgeted = opts.onlyBudgeted ?? true;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const today = todayIn(user.timezone);
  const fx = await loadFx(userId, db);
  const yearBounds = { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
  // 1-12 in the current year, 13 for a past year (every month complete), 0 for a future one.
  const currentMonth = today.y === year ? today.m : today.y > year ? 13 : 0;
  const nElapsed = Math.min(currentMonth, 12);
  const completeMonths = Math.max(0, Math.min(currentMonth - 1, 12));

  const spend = await spendBySlot(db, userId, yearBounds, today.end, entityIds, true);
  const byMonth = (await getEffectiveBudgetsByMonth(db, userId, year)).map((bs) => bs.filter(budgetInScope(entityIds)));
  const monthly = byMonth.map((bs) => bs.filter((b) => b.period === "monthly"));
  const yearly = byMonth[11].filter((b) => b.period === "yearly");
  const name = await categoryNames(db, userId);
  const order = await rowOrder(db, userId);

  // Row slots: every (entity or every entity, category) with a monthly budget in force in some month of the year.
  const slots = new Map<string, { entityId: string | null; categoryId: string | null; budgeted: boolean }>();
  for (const bs of monthly) for (const b of bs) slots.set(slotKey(b.entityId, b.categoryId), { entityId: b.entityId, categoryId: b.categoryId, budgeted: true });

  const cells = new Map<string, { actual: number[]; committed: number[] }>();
  const cellsOf = (key: string) => {
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { actual: Array(12).fill(0), committed: Array(12).fill(0) }));
    return c;
  };
  for (const s of spend) {
    const i = s.month - 1;
    const inForce = budgetFor(monthly[i], s.entityId, s.categoryId);
    let key: string | null = inForce ? slotKey(inForce.entityId, inForce.categoryId) : null;
    // A month without a budget in force still lands on the row of its slot (own entity first, then every entity).
    if (!key && slots.has(slotKey(s.entityId, s.categoryId))) key = slotKey(s.entityId, s.categoryId);
    if (!key && s.categoryId && slots.has(slotKey(null, s.categoryId))) key = slotKey(null, s.categoryId);
    if (!key) {
      if (onlyBudgeted || budgetFor(yearly, s.entityId, s.categoryId)) continue;
      key = slotKey(s.entityId, s.categoryId);
      if (!slots.has(key)) slots.set(key, { entityId: s.entityId, categoryId: s.categoryId, budgeted: false });
    }
    const c = cellsOf(key);
    // Complete months count everything; the current month counts what is dated up to today.
    c.actual[i] += s.month < currentMonth ? s.spent : s.spentToDate;
    c.committed[i] += s.spent;
  }

  type YearInsight = {
    kind: YearInsightKind;
    budgetId: string;
    entityId: string | null;
    categoryId: string | null;
    category: string | null;
    overMonths: number;
    nElapsed: number;
    avg: number;
    budget: number;
    suggested: number;
    first3: number | null;
    last3: number | null;
    growth: number | null;
    peakMonth: number;
    peakValue: number;
  };
  const insightOf = new Map<string, YearInsight>();

  const matrix = [...slots.entries()].map(([key, slot]) => {
    const { actual, committed } = cells.get(key) ?? { actual: Array(12).fill(0), committed: Array(12).fill(0) };
    const budgetAt = (i: number) => monthly[i].find((b) => b.entityId === slot.entityId && b.categoryId === slot.categoryId) ?? null;
    const complete = actual.slice(0, completeMonths);
    const lastThree = complete.slice(-3);
    const firstThree = complete.slice(0, 3);
    const projectionBase = mean(lastThree);
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const budget = budgetAt(i);
      const isProjected = m > currentMonth;
      const value = isProjected ? Math.max(projectionBase, committed[i]) : actual[i];
      const budgetAmount = budget ? baseAmount(fx, budget) : null;
      return {
        month: m,
        spent: round(value, 2),
        isProjected,
        isPartial: m === currentMonth,
        budget: budgetAmount,
        budgetId: budget?.id ?? null,
        percentUsed: budgetAmount ? round((value / budgetAmount) * 100, 1) : null,
      };
    });
    const trend = complete.length >= 6 && mean(firstThree) > 0 ? round(mean(lastThree) / mean(firstThree) - 1, 4) : null;
    const elapsed = months.slice(0, nElapsed);
    const overMonths = elapsed.filter((x) => x.budget !== null && x.spent > x.budget).length;
    const budgetedMonths = elapsed.filter((x) => x.budget !== null).length;
    // The budget the row stands for now: the latest in force up to the current month, else the first of the year.
    const refIndex = [...Array(nElapsed).keys()].reverse().find((i) => budgetAt(i)) ?? [...Array(12).keys()].find((i) => budgetAt(i));
    const ref = refIndex === undefined ? null : budgetAt(refIndex);

    if (ref && nElapsed > 0) {
      const values = elapsed.map((x) => x.spent);
      // The monthly average leaves out the month in progress (a few days of it would drag it down), unless no month is complete yet.
      const avg = mean(complete.length ? complete : values);
      const budget = baseAmount(fx, ref);
      const peakValue = Math.max(...values);
      const growth = trend;
      const kind: YearInsightKind | null =
        overMonths >= INSIGHT_RULES.overrunMonths
          ? "overrun"
          : growth !== null && growth > INSIGHT_RULES.growth
            ? "growth"
            : peakValue > budget * INSIGHT_RULES.seasonalPeak
              ? "seasonal"
              : null;
      if (kind) {
        insightOf.set(key, {
          kind,
          budgetId: ref.id,
          entityId: slot.entityId,
          categoryId: slot.categoryId,
          category: name(slot.categoryId),
          overMonths,
          nElapsed,
          avg: round(avg, 2),
          budget,
          suggested: suggestedBudget(avg),
          first3: firstThree.length ? round(mean(firstThree), 2) : null,
          last3: lastThree.length ? round(mean(lastThree), 2) : null,
          growth,
          peakMonth: values.indexOf(peakValue) + 1,
          peakValue: round(peakValue, 2),
        });
      }
    }

    return {
      entityId: slot.entityId,
      categoryId: slot.categoryId,
      category: name(slot.categoryId),
      isBudgeted: slot.budgeted,
      budgetId: ref?.id ?? null,
      budget: ref ? baseAmount(fx, ref) : null,
      excludeEntityIds: ref && refIndex !== undefined ? excludedEntities(monthly[refIndex], ref) : [],
      months,
      yearTotal: round(months.reduce((s, x) => s + x.spent, 0), 2),
      trend,
      overMonths,
      budgetedMonths,
    };
  });
  matrix.sort((a, b) => Number(b.isBudgeted) - Number(a.isBudgeted) || order(a, b));
  // By kind (overrun, growth, seasonal), then in the matrix's row order.
  const rowInsights = matrix.map((r) => insightOf.get(slotKey(r.entityId, r.categoryId))).filter((i): i is YearInsight => !!i);
  const insights = INSIGHT_KINDS.flatMap((kind) => rowInsights.filter((i) => i.kind === kind));

  const monthTotals = Array.from({ length: 12 }, (_, i) => round(matrix.reduce((s, r) => s + r.months[i].spent, 0), 2));
  const monthBudgets = monthly.map((bs) => round(bs.reduce((s, b) => s + baseAmount(fx, b), 0), 2));
  const yearPace = yearPaceOf(year, today);
  const yearlyBudgets = yearlyRows(yearly, spend, name, yearPace, entityIds, fx).sort(order);

  return {
    year,
    /** 1-12 in the current year, 12 for a past one, 0 for a future one (kept for older clients). */
    currentMonth: Math.min(currentMonth, 12),
    period: {
      year,
      today: today.iso,
      nElapsed,
      completeMonths,
      isPast: currentMonth === 13,
      yearPace,
      /** Months (1-12) whose average projects the rest of the year, e.g. [6, 8] = jun–ago; null when nothing is projected. */
      projectionBasis: completeMonths > 0 && currentMonth <= 12 ? ([Math.max(1, completeMonths - 2), completeMonths] as [number, number]) : null,
    },
    scope: { entityIds },
    categories: matrix,
    monthTotals,
    monthBudgets,
    summary: {
      spentToDate: round(monthTotals.slice(0, nElapsed).reduce((s, v) => s + v, 0), 2),
      budgetToDate: round(monthBudgets.slice(0, nElapsed).reduce((s, v) => s + v, 0), 2),
      projectedYear: round(monthTotals.reduce((s, v) => s + v, 0), 2),
      budgetYear: round(monthBudgets.reduce((s, v) => s + v, 0), 2),
      overBudgetMonths: matrix.reduce((s, r) => s + r.overMonths, 0),
      budgetedCells: matrix.reduce((s, r) => s + r.budgetedMonths, 0),
    },
    insights,
    yearlyBudgets,
  };
}

export type YearOverview = Awaited<ReturnType<typeof yearOverview>>;
