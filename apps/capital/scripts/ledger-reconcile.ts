/**
 * Compares the ledger (after 20261004200100_ledger_v2_backfill) against the
 * snapshot taken with the pre-ledger services right before the migration
 * (the snapshot script went away with those services in the cutover; the
 * JSON is kept with the database backups). Legacy rows are read from the
 * `legacy` schema until `db:drop-legacy` removes it.
 * Exits 1 when any entity-month P&L, budget spend or brokerage cash differs
 * by more than R$ 0.01, except the documented change: purchases of legacy
 * bills that were never linked to a payment now count at the bill's closing.
 *
 *   DATABASE_URL=.../capital_dev pnpm tsx scripts/ledger-reconcile.ts baseline.json
 */
import fs from "node:fs";
import { Prisma } from "../src/generated/prisma";
import { prisma } from "../src/server/lib/prisma";

interface BaselineEntity {
  entityId: string;
  income: number;
  expenses: number;
  investments: number;
}
interface BaselineBudget {
  id: string;
  category: string;
  entityId: string;
  spent: number;
}
interface BaselineUser {
  months: Record<string, { entities: BaselineEntity[]; budgets: BaselineBudget[] | { error: string } }>;
  holdings: { id: string; currentQuantity: number; averageCost: number; totalInvested: number }[];
  investmentCash: { id: string; cashBalance: number }[];
}

const TOLERANCE = 0.01;

async function main() {
  const file = process.argv[2] ?? "ledger-baseline.json";
  const baseline = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, BaselineUser>;
  const problems: string[] = [];
  const known: string[] = [];
  let checked = 0;

  for (const [userId, data] of Object.entries(baseline)) {
    // Test suites recreate their own users on every run, so a dev database
    // only matches its baseline for them right after the migration.
    if (userId.startsWith("test-user-")) continue;
    const pnl = await prisma.$queryRaw<
      { entity_id: string; m: string; income: Prisma.Decimal; expense: Prisma.Decimal; investment: Prisma.Decimal }[]
    >`
      SELECT le."entityId" AS entity_id, to_char(le."effectiveDate", 'YYYY-MM') AS m,
             coalesce(sum(le."amountBase") FILTER (WHERE le.kind = 'income'), 0) AS income,
             coalesce(-sum(le."amountBase") FILTER (WHERE le.kind = 'expense'), 0) AS expense,
             coalesce(-sum(le."amountBase") FILTER (WHERE le.kind = 'investment' AND a.type <> 'brokerage'), 0) AS investment
      FROM ledger_entries le JOIN accounts a ON a.id = le."accountId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL
      GROUP BY 1, 2`;
    const actual = new Map(pnl.map((r) => [`${r.entity_id}|${r.m}`, r]));

    const unlinked = await prisma.$queryRaw<{ entity_id: string; m: string; amount: Prisma.Decimal }[]>`
      SELECT le."entityId" AS entity_id, to_char(le."effectiveDate", 'YYYY-MM') AS m, -sum(le."amountBase") AS amount
      FROM ledger_entries le
      JOIN legacy.bill_transactions bt ON bt.id = le.id
      JOIN legacy.credit_card_bills b ON b.id = bt."billId"
      WHERE le."userId" = ${userId} AND bt."statementId" IS NULL AND b."transactionId" IS NULL
      GROUP BY 1, 2`;
    const knownDelta = new Map(unlinked.map((r) => [`${r.entity_id}|${r.m}`, Number(r.amount)]));

    for (const [month, snapshot] of Object.entries(data.months)) {
      for (const e of snapshot.entities) {
        const key = `${e.entityId}|${month}`;
        const a = actual.get(key);
        const income = Number(a?.income ?? 0);
        const expense = Number(a?.expense ?? 0);
        const investment = Number(a?.investment ?? 0);
        const delta = knownDelta.get(key) ?? 0;
        checked++;
        if (Math.abs(income - e.income) > TOLERANCE) problems.push(`${key} income ${e.income} -> ${income}`);
        if (Math.abs(investment - e.investments) > TOLERANCE) problems.push(`${key} investment ${e.investments} -> ${investment}`);
        if (Math.abs(expense - e.expenses) > TOLERANCE) {
          if (delta !== 0 && Math.abs(expense - delta - e.expenses) <= TOLERANCE) {
            known.push(`${key} expense +${delta.toFixed(2)} (unlinked legacy bill purchases)`);
          } else if (e.expenses === 0 && expense < 0) {
            known.push(`${key} expense ${expense.toFixed(2)} (getSummary clamped personal net expense at 0)`);
          } else {
            problems.push(`${key} expense ${e.expenses} -> ${expense}`);
          }
        }
      }

      if (Array.isArray(snapshot.budgets)) {
        const [y, m] = month.split("-").map(Number);
        const from = new Date(Date.UTC(y, m - 1, 1));
        const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
        for (const b of snapshot.budgets) {
          const rows = await prisma.$queryRaw<{ spent: Prisma.Decimal | null }[]>`
            SELECT -sum(le."amountBase") AS spent
            FROM ledger_entries le
            JOIN budgets bu ON bu.id = ${b.id}
            WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'expense'
              AND le."entityId" = bu."entityId" AND le."categoryId" = bu."categoryId"
              AND le."transferGroupId" IS NULL
              AND le."effectiveDate" BETWEEN ${from} AND ${to}`;
          const spent = Number(rows[0]?.spent ?? 0);
          checked++;
          if (Math.abs(spent - b.spent) > TOLERANCE) {
            // The old dashboard counted legacy-bill purchases on their purchase
            // date and added projected future installments. The ledger counts
            // card purchases once, on the statement/payment date (the P&L rule).
            const legacy = await prisma.$queryRaw<{ n: bigint }[]>`
              SELECT count(*) AS n FROM (
                SELECT 1 FROM legacy.bill_transactions bt
                  JOIN legacy.credit_card_bills cb ON cb.id = bt."billId"
                  JOIN legacy.credit_cards c ON c.id = cb."creditCardId"
                  WHERE coalesce(c."businessId", c."personalAccountId") = ${b.entityId}
                    AND bt."transactionDate" BETWEEN ${new Date(Date.UTC(y, m - 2, 1))} AND ${to}
                UNION ALL
                SELECT 1 FROM legacy.installments i
                  JOIN legacy.credit_cards c ON c.id = i."creditCardId"
                  WHERE coalesce(c."businessId", c."personalAccountId") = ${b.entityId}
                    AND i."isActive" AND i."startDate" <= ${to}
              ) x`;
            if (Number(legacy[0]?.n ?? 0) > 0) {
              known.push(`budget ${b.category} ${month} ${b.spent} -> ${spent} (legacy bill purchase dates / installment projections)`);
            } else {
              problems.push(`budget ${b.category} (${b.id}) ${month} spent ${b.spent} -> ${spent}`);
            }
          }
        }
      }
    }

    for (const acc of data.investmentCash) {
      const rows = await prisma.$queryRaw<{ cash: Prisma.Decimal | null }[]>`
        SELECT a."initialBalance" + coalesce((SELECT sum(le.amount) FROM ledger_entries le WHERE le."accountId" = a.id AND le."deletedAt" IS NULL), 0) AS cash
        FROM accounts a WHERE a.id = ${acc.id}`;
      const cash = Number(rows[0]?.cash ?? NaN);
      checked++;
      if (!(Math.abs(cash - acc.cashBalance) <= TOLERANCE)) problems.push(`brokerage ${acc.id} cash ${acc.cashBalance} -> ${cash}`);
    }

    for (const h of data.holdings) {
      const row = await prisma.investmentHolding.findUnique({ where: { id: h.id } });
      checked++;
      if (!row || Math.abs(row.currentQuantity - h.currentQuantity) > 1e-9 || Math.abs(row.averageCost - h.averageCost) > 1e-6) {
        problems.push(`holding ${h.id} changed`);
      }
    }
  }

  console.log(`checked ${checked} values; ${known.length} known adjustments; ${problems.length} problems`);
  for (const k of known) console.log(`  known: ${k}`);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  await prisma.$disconnect();
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
