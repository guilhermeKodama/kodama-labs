/**
 * Backtest of the budget projection against the one it replaced.
 *
 * Synthetic (seeded, no database):
 *   pnpm --filter @wallex/capital projection:backtest
 *
 * Against a database, read-only:
 *   DATABASE_URL=postgresql://…/capital CAPITAL_ALLOW_PROD_DB=1 \
 *     pnpm --filter @wallex/capital projection:backtest --database
 *
 * The database mode runs every query inside one READ ONLY transaction and
 * prints error tables and counts only: no description, merchant,
 * category, user or amount of a single transaction. Merchant names are
 * folded into in-memory keys to find recurring bills and never leave the
 * process. Outside NODE_ENV=production, a database whose name does not
 * end in _dev or _test needs CAPITAL_ALLOW_PROD_DB=1 (src/server/lib/db-guard.ts).
 */
import { PrismaClient } from "../src/generated/prisma";
import { budgetKind } from "../src/lib/budgets/kind";
import { assertNonProductionDatabase } from "../src/server/lib/db-guard";
import { merchantKey } from "../src/server/modules/budgets/lib/project";
import { formatReport, runBacktest, syntheticSeries, type Charge, type Series } from "../src/server/modules/budgets/lib/projection-backtest";

interface EntryRow {
  user_id: string;
  entity_id: string;
  category_id: string;
  ym: string;
  day: number;
  raw_day: number;
  amount: unknown;
  rule_id: string | null;
  label: string | null;
  kind: string;
}

interface BudgetRow {
  user_id: string;
  entity_id: string | null;
  category_id: string;
  kind: string | null;
  amount: unknown;
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** Series of the latest monthly budget of each slot, over the closed months. Spend of an entity goes to its own budget, else to the one for every entity. */
function seriesFrom(entries: readonly EntryRow[], budgets: readonly BudgetRow[], currentYm: string) {
  const own = new Map<string, BudgetRow>();
  for (const b of budgets) own.set(`${b.user_id}|${b.entity_id ?? "*"}|${b.category_id}`, b);
  const closed = entries.filter((e) => e.ym < currentYm);
  if (!closed.length) return { series: [] as Series[], months: 0 };
  const first = Math.min(...closed.map((e) => monthIndex(e.ym)));
  const months = monthIndex(currentYm) - first;
  const bySlot = new Map<string, { budget: BudgetRow; months: Charge[][]; ruleKeys: Set<string> }>();
  for (const e of closed) {
    const budget = own.get(`${e.user_id}|${e.entity_id}|${e.category_id}`) ?? own.get(`${e.user_id}|*|${e.category_id}`);
    if (!budget) continue;
    const slot = `${budget.user_id}|${budget.entity_id ?? "*"}|${budget.category_id}`;
    let s = bySlot.get(slot);
    if (!s) bySlot.set(slot, (s = { budget, months: Array.from({ length: months }, () => []), ruleKeys: new Set() }));
    const amount = Number(e.amount);
    let key: string | undefined;
    if (e.kind === "expense" && amount > 0) {
      key = e.rule_id ? `r${e.rule_id}` : merchantKey(e.label ?? "") || undefined;
      if (e.rule_id) s.ruleKeys.add(key);
    }
    s.months[monthIndex(e.ym) - first]?.push({ day: Number(e.day), rawDay: Number(e.raw_day), amount, key });
  }
  const users = new Map<string, number>();
  const series: Series[] = [];
  for (const s of bySlot.values()) {
    const start = s.months.findIndex((m) => m.length > 0);
    if (start < 0) continue;
    if (!users.has(s.budget.user_id)) users.set(s.budget.user_id, users.size);
    series.push({ household: users.get(s.budget.user_id) ?? 0, kind: budgetKind(s.budget.kind), budget: Number(s.budget.amount), start, months: s.months, ruleKeys: s.ruleKeys });
  }
  return { series, months };
}

async function fromDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. This mode only reads; point it at the database to score.");
  assertNonProductionDatabase(url, "projection backtest");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [mode] = await tx.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
        if (mode?.transaction_read_only !== "on") throw new Error("Could not open a read-only transaction; nothing was read.");
        const economic = `(CASE WHEN le."cardStatementId" IS NOT NULL THEN le.date ELSE le."effectiveDate" END)`;
        const entries = await tx.$queryRawUnsafe<EntryRow[]>(`
          SELECT le."userId" AS user_id, le."entityId" AS entity_id,
                 (CASE WHEN le.kind = 'expense' THEN le."categoryId" ELSE le."reimbursesCategoryId" END) AS category_id,
                 to_char(date_trunc('month', le."effectiveDate"), 'YYYY-MM') AS ym,
                 (CASE WHEN ${economic} < date_trunc('month', le."effectiveDate") THEN 1 ELSE extract(day FROM ${economic})::int END) AS day,
                 extract(day FROM ${economic})::int AS raw_day,
                 -le."amountBase" AS amount,
                 le."recurringRuleId" AS rule_id,
                 coalesce(nullif(le."merchantName", ''), le.description) AS label,
                 le.kind::text AS kind
          FROM ledger_entries le
          WHERE le."deletedAt" IS NULL AND le."transferGroupId" IS NULL
            AND ((le.kind = 'expense' AND le."categoryId" IS NOT NULL) OR (le.kind = 'income' AND le."reimbursesCategoryId" IS NOT NULL))`);
        const budgets = await tx.$queryRawUnsafe<BudgetRow[]>(`
          SELECT DISTINCT ON ("userId", coalesce("entityId", '*'), "categoryId")
                 "userId" AS user_id, "entityId" AS entity_id, "categoryId" AS category_id, kind::text AS kind, amount
          FROM budgets
          WHERE period = 'monthly' AND "isActive" = true AND "isTombstone" = false
          ORDER BY "userId", coalesce("entityId", '*'), "categoryId", "effectiveFrom" DESC`);
        const diagnostics = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`
          WITH net AS (
            SELECT le."userId", le."entityId", (CASE WHEN le.kind = 'expense' THEN le."categoryId" ELSE le."reimbursesCategoryId" END) AS cat,
                   date_trunc('month', le."effectiveDate") AS m, sum(-le."amountBase") AS total
            FROM ledger_entries le
            WHERE le."deletedAt" IS NULL AND le."transferGroupId" IS NULL
              AND ((le.kind = 'expense' AND le."categoryId" IS NOT NULL) OR (le.kind = 'income' AND le."reimbursesCategoryId" IS NOT NULL))
            GROUP BY 1, 2, 3, 4
          )
          SELECT
            (SELECT count(*) FROM net WHERE total < 0)::int AS negative_category_months,
            (SELECT count(*) FROM net)::int AS category_months,
            (SELECT count(*) FROM ledger_entries le WHERE le."deletedAt" IS NULL AND le.kind = 'expense' AND le."amountBase" > 0)::int AS expense_credits,
            (SELECT count(*) FROM ledger_entries le WHERE le."deletedAt" IS NULL AND le.kind = 'expense' AND le."cardStatementId" IS NOT NULL)::int AS card_purchases,
            (SELECT count(*) FROM ledger_entries le WHERE le."deletedAt" IS NULL AND le.kind = 'expense' AND le."cardStatementId" IS NOT NULL
                AND le.date < date_trunc('month', le."effectiveDate"))::int AS card_previous_cycle,
            (SELECT count(*) FROM ledger_entries le JOIN categories c ON c.id = le."categoryId"
              WHERE le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL AND c."systemKey" = 'credit_card' AND le."cardStatementId" IS NULL)::int AS bill_payments_as_expense,
            (SELECT count(*) FROM recurring_rules r WHERE r."isActive" AND r.kind = 'expense' AND r."categoryId" IS NOT NULL)::int AS active_expense_rules`);
        return { entries, budgets, diagnostics: diagnostics[0] ?? {} };
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    const now = new Date();
    const currentYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const { series, months } = seriesFrom(result.entries, result.budgets, currentYm);
    console.log(`Read-only backtest: ${series.length} budget series, ${months} closed months. Errors and counts only.\n`);
    console.log(formatReport(runBacktest(series)));
    console.log("\n| Diagnóstico (contagens) | valor |\n|---|---:|");
    for (const [key, value] of Object.entries(result.diagnostics)) console.log(`| ${key} | ${String(value)} |`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv.includes("--database")) {
  fromDatabase().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  const series = syntheticSeries();
  console.log(`Synthetic backtest: ${series.length} series from 300 seeded households, 14 months each. Each point is the forecast on day 5, 10, 15, 20 or 25 against the closed month.\n`);
  console.log(formatReport(runBacktest(series)));
}
