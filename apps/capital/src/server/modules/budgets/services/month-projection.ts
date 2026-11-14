import { addDays, addMonths } from "date-fns";
import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { entityScopeSql, entityScopeWhere } from "@capital/server/lib/entity-scope";
import type { FxContext } from "@capital/server/modules/ledger/lib/fx";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { monthDaySql } from "@capital/server/modules/ledger/lib/spend-as-of";
import {
  detectRecurring,
  merchantKey,
  projectMonth,
  recurringExpectation,
  type ChargeObservation,
  type HistoryMonth,
  type MonthProjection,
  type RuleOccurrence,
} from "../lib/project";

/** Complete months before the current one whose spend shapes a projection. */
export const HISTORY_MONTHS = 6;

/** Rows that count against one budget (or one unbudgeted series) and what they hold this month. */
export interface ProjectionGroup {
  key: string;
  kind: "fixo" | "variavel";
  /** Available this month in base currency; 0 without a budget. */
  budget: number;
  owns: (entityId: string, categoryId: string | null) => boolean;
  /** Net through today. */
  spent: number;
  /** Net booked for the whole month. */
  committed: number;
}

interface HistoryRow {
  entityId: string;
  categoryId: string | null;
  month: string;
  total: number;
  rest: number;
}

interface ChargeRow extends ChargeObservation {
  entityId: string;
  categoryId: string | null;
}

/** Expense category of a row: its own for an expense, the one it reimburses for an income. */
const netCategorySql = Prisma.sql`(CASE WHEN le.kind = 'expense' THEN le."categoryId" ELSE le."reimbursesCategoryId" END)`;
const netRowsSql = Prisma.sql`((le.kind = 'expense' AND le."categoryId" IS NOT NULL) OR (le.kind = 'income' AND le."reimbursesCategoryId" IS NOT NULL))`;

/**
 * Net spend of each (entity, category) per complete month before
 * `year`/`month`, and the part of it after day `day`. The day is the
 * row's day in the month it counts in (monthDaySql): a card purchase from
 * the previous cycle is day 1. Transfers, investments and aportes are not
 * here. A month with no rows is absent, not a zero.
 */
async function netHistory(db: DbClient, userId: string, year: number, month: number, day: number, entityIds: string[] | null): Promise<HistoryRow[]> {
  const from = new Date(Date.UTC(year, month - 1 - HISTORY_MONTHS, 1));
  const to = new Date(Date.UTC(year, month - 1, 1) - 1);
  const rows = await db.$queryRaw<{ entity_id: string; category_id: string | null; ym: string; total: Prisma.Decimal; rest: Prisma.Decimal }[]>`
    SELECT le."entityId" AS entity_id, ${netCategorySql} AS category_id,
           to_char(date_trunc('month', le."effectiveDate"), 'YYYY-MM') AS ym,
           coalesce(sum(-le."amountBase"), 0) AS total,
           coalesce(sum(-le."amountBase") FILTER (WHERE ${monthDaySql("le")} > ${day}), 0) AS rest
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le."transferGroupId" IS NULL AND ${netRowsSql}
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    GROUP BY 1, 2, 3`;
  return rows.map((r) => ({ entityId: r.entity_id, categoryId: r.category_id, month: r.ym, total: toNumber(r.total), rest: toNumber(r.rest) }));
}

/**
 * Individual expenses of the history window and of this month up to
 * today, keyed by the recurring rule that booked them or by the folded
 * merchant. The label is folded here and does not leave this function.
 */
async function charges(db: DbClient, userId: string, year: number, month: number, asOf: Date, entityIds: string[] | null): Promise<ChargeRow[]> {
  const from = new Date(Date.UTC(year, month - 1 - HISTORY_MONTHS, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const rows = await db.$queryRaw<{ entity_id: string; category_id: string | null; ym: string; rule_id: string | null; label: string; day: number; amount: Prisma.Decimal }[]>`
    SELECT le."entityId" AS entity_id, le."categoryId" AS category_id,
           to_char(date_trunc('month', le."effectiveDate"), 'YYYY-MM') AS ym,
           le."recurringRuleId" AS rule_id,
           coalesce(nullif(le."merchantName", ''), le.description) AS label,
           ${monthDaySql("le")} AS day,
           -le."amountBase" AS amount
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."categoryId" IS NOT NULL AND le."amountBase" < 0
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      AND (CASE WHEN le."cardStatementId" IS NOT NULL THEN le.date ELSE le."effectiveDate" END) <= ${asOf}
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}`;
  return rows.flatMap((r) => {
    const key = r.rule_id ? `rule:${r.rule_id}` : merchantKey(r.label);
    if (key.length < 3) return [];
    return [{ entityId: r.entity_id, categoryId: r.category_id, month: r.ym, key, day: Number(r.day), amount: toNumber(r.amount) }];
  });
}

/** Dates of a rule's occurrences from its next due date through the end of the month. */
export function occurrencesIn(next: Date, frequency: string, monthStart: Date, monthEnd: Date, endDate: Date | null): number {
  let count = 0;
  let at = next;
  for (let i = 0; i < 40 && at <= monthEnd && (!endDate || at <= endDate); i++) {
    if (at >= monthStart) count += 1;
    at = frequency === "daily" ? addDays(at, 1) : frequency === "weekly" ? addDays(at, 7) : frequency === "yearly" ? addMonths(at, 12) : addMonths(at, 1);
  }
  return count;
}

/** Expense rules (recurring bills) still due this month, one entry per rule, in base currency. */
async function dueRules(db: DbClient, userId: string, year: number, month: number, entityIds: string[] | null, fx: FxContext) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const rules = await db.recurringRule.findMany({
    where: { userId, isActive: true, kind: "expense", categoryId: { not: null }, nextDueDate: { lte: monthEnd }, ...entityScopeWhere(entityIds) },
    select: { id: true, entityId: true, categoryId: true, amount: true, currency: true, exchangeRate: true, frequency: true, nextDueDate: true, endDate: true },
  });
  return rules.flatMap((r) => {
    const count = occurrencesIn(r.nextDueDate, r.frequency, monthStart, monthEnd, r.endDate);
    if (!count) return [];
    const rate = r.exchangeRate ? toNumber(r.exchangeRate) : fx.rateFor(r.currency);
    return [{ entityId: r.entityId, categoryId: r.categoryId, key: `rule:${r.id}`, amount: toNumber(r.amount) * rate * count }];
  });
}

/**
 * End-of-month projection of each group for the month in progress
 * (`day` is today, 1 to the month's last day minus one).
 */
export async function projectRunningMonth(
  db: DbClient,
  userId: string,
  period: { year: number; month: number; day: number; asOf: Date },
  entityIds: string[] | null,
  fx: FxContext,
  groups: readonly ProjectionGroup[],
): Promise<Map<string, MonthProjection>> {
  const out = new Map<string, MonthProjection>();
  if (!groups.length) return out;
  const { year, month, day, asOf } = period;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const [history, chargeRows, rules] = await Promise.all([
    netHistory(db, userId, year, month, day, entityIds),
    groups.some((g) => g.kind === "fixo") ? charges(db, userId, year, month, asOf, entityIds) : Promise.resolve([] as ChargeRow[]),
    dueRules(db, userId, year, month, entityIds, fx),
  ]);
  for (const group of groups) {
    const byMonth = new Map<string, HistoryMonth>();
    for (const row of history) {
      if (!group.owns(row.entityId, row.categoryId)) continue;
      const slot = byMonth.get(row.month) ?? { total: 0, rest: 0 };
      slot.total += row.total;
      slot.rest += row.rest;
      byMonth.set(row.month, slot);
    }
    const bills = group.kind === "fixo" ? detectRecurring(chargeRows.filter((c) => group.owns(c.entityId, c.categoryId)), ym) : [];
    const due: RuleOccurrence[] = rules.filter((r) => group.owns(r.entityId, r.categoryId)).map((r) => ({ key: r.key, amount: r.amount }));
    out.set(
      group.key,
      projectMonth({
        kind: group.kind,
        spent: group.spent,
        committed: group.committed,
        budget: group.budget,
        elapsed: day / new Date(Date.UTC(year, month, 0)).getUTCDate(),
        history: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
        recurring: recurringExpectation(bills, due),
      }),
    );
  }
  return out;
}
