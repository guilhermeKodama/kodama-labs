import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma, type Budget } from "@/generated/prisma";
import { entityScopeSql, inEntityScope } from "@capital/server/lib/entity-scope";
import { budgetKind, type BudgetKindName } from "@/lib/budgets/kind";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { budgetFor } from "../lib/assign";
import { getEffectiveBudgetsByMonth } from "../lib/effective-budgets";
import type { BudgetScope } from "./budget-overview";

const MAX_MONTHS = 36;

export interface CompositionOptions extends BudgetScope {
  /** How many variable categories to return per month. Default 5. */
  limit?: number;
}

interface SlotAmount {
  entityId: string;
  categoryId: string;
  year: number;
  month: number;
  amount: number;
}

interface Totals {
  budgeted: number;
  gross: number;
  reimbursed: number;
  net: number;
}

const emptyTotals = (): Totals => ({ budgeted: 0, gross: 0, reimbursed: 0, net: 0 });

const add = (into: Totals, row: Totals) => {
  into.budgeted = round(into.budgeted + row.budgeted, 2);
  into.gross = round(into.gross + row.gross, 2);
  into.reimbursed = round(into.reimbursed + row.reimbursed, 2);
  into.net = round(into.net + row.net, 2);
};

/** Inclusive month list. Throws when the range is backwards or longer than 36 months. */
function monthsOf(from: string, to: string): { year: number; month: number }[] {
  const start = parseMonth(from);
  const end = parseMonth(to);
  if (!start || !end || start.year * 12 + start.month > end.year * 12 + end.month) {
    throw new LedgerError("The range must run from an earlier month to a later one, at most 36 months", 400, { code: "budget.composition_range" });
  }
  const months: { year: number; month: number }[] = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    if (months.length > MAX_MONTHS) {
      throw new LedgerError("The range must run from an earlier month to a later one, at most 36 months", 400, { code: "budget.composition_range" });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

const baseAmount = (fx: FxContext, b: Pick<Budget, "amount" | "currency">) => round(toNumber(b.amount) * fx.rateFor(b.currency), 2);

async function grouped(
  db: DbClient,
  userId: string,
  range: { from: Date; to: Date },
  entityIds: string[] | null,
  mode: "expense" | "reimbursement",
): Promise<SlotAmount[]> {
  const category = mode === "expense" ? Prisma.sql`le."categoryId"` : Prisma.sql`le."reimbursesCategoryId"`;
  const amount = mode === "expense" ? Prisma.sql`coalesce(-sum(le."amountBase"), 0)` : Prisma.sql`coalesce(sum(le."amountBase"), 0)`;
  const kind = mode === "expense" ? Prisma.sql`le.kind = 'expense'` : Prisma.sql`le.kind = 'income' AND le."reimbursesCategoryId" IS NOT NULL`;
  const rows = await db.$queryRaw<{ entity_id: string; category_id: string; y: number; m: number; amount: Prisma.Decimal }[]>`
    SELECT le."entityId" AS entity_id, ${category} AS category_id,
           extract(year FROM le."effectiveDate")::int AS y,
           extract(month FROM le."effectiveDate")::int AS m,
           ${amount} AS amount
    FROM ledger_entries le
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le."transferGroupId" IS NULL
      AND ${kind}
      AND le."effectiveDate" BETWEEN ${range.from} AND ${range.to}
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    GROUP BY 1, 2, 3, 4`;
  return rows.map((row) => ({
    entityId: row.entity_id,
    categoryId: row.category_id,
    year: row.y,
    month: row.m,
    amount: toNumber(row.amount),
  }));
}

const assigned = (list: readonly SlotAmount[], budgets: readonly Budget[], budget: Budget, year: number, month: number) =>
  list
    .filter((row) => row.year === year && row.month === month && budgetFor(budgets, row.entityId, row.categoryId)?.id === budget.id)
    .reduce((sum, row) => sum + row.amount, 0);

/**
 * Fixed vs variable totals for each month in a range, and the variable
 * categories with the highest net cost. A budget with no kind counts as
 * variável. Figures are the whole month (committed), in the base currency.
 * The category of an expense, and the expense category an income reimburses,
 * pick the budget. One budget per category, period and scope.
 */
export async function budgetComposition(userId: string, from: string, to: string, db: DbClient, opts: CompositionOptions = {}) {
  const months = monthsOf(from, to);
  const limit = opts.limit ?? 5;
  const entityIds = opts.entityIds ?? null;
  const first = months[0];
  const last = months[months.length - 1];
  const range = {
    from: new Date(Date.UTC(first.year, first.month - 1, 1)),
    to: new Date(Date.UTC(last.year, last.month, 0, 23, 59, 59, 999)),
  };
  const years = [...new Set(months.map((month) => month.year))];
  const [fx, names, expenses, reimbursements, byYear] = await Promise.all([
    loadFx(userId, db),
    db.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    grouped(db, userId, range, entityIds, "expense"),
    grouped(db, userId, range, entityIds, "reimbursement"),
    Promise.all(years.map(async (year) => [year, await getEffectiveBudgetsByMonth(db, userId, year)] as const)),
  ]);
  const nameOf = new Map(names.map((category) => [category.id, category.name]));
  const budgetsOfYear = new Map(byYear);

  const rows = months.map(({ year, month }) => {
    const inForce = (budgetsOfYear.get(year)?.[month - 1] ?? []).filter((budget) => !budget.entityId || inEntityScope(entityIds, budget.entityId));
    const budgets = inForce.filter((budget) => budget.period === "monthly");
    const fixo = emptyTotals();
    const variavel = emptyTotals();
    const ranked: {
      categoryId: string;
      category: string;
      entityId: string | null;
      kind: BudgetKindName;
      budgeted: number;
      gross: number;
      reimbursed: number;
      net: number;
    }[] = [];
    for (const budget of budgets) {
      const kind = budgetKind(budget.kind);
      const gross = round(assigned(expenses, budgets, budget, year, month), 2);
      const reimbursed = round(assigned(reimbursements, budgets, budget, year, month), 2);
      const row = {
        categoryId: budget.categoryId,
        category: nameOf.get(budget.categoryId) ?? "?",
        entityId: budget.entityId,
        kind,
        budgeted: baseAmount(fx, budget),
        gross,
        reimbursed,
        net: round(gross - reimbursed, 2),
      };
      add(kind === "fixo" ? fixo : variavel, row);
      if (kind === "variavel") ranked.push(row);
    }
    const total = emptyTotals();
    add(total, fixo);
    add(total, variavel);
    ranked.sort((a, b) => b.net - a.net || a.category.localeCompare(b.category, "pt-BR"));
    return { year, month, fixo, variavel, total, topVariable: ranked.slice(0, limit) };
  });

  return { from, to, months: rows };
}
