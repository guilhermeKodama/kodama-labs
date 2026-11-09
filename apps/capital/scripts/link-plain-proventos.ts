/**
 * Turns plain income in Proventos / Rendimentos into a linked dividend
 * without crediting the cash again (convert_income_to_dividend).
 *
 * September 2026 was booked that way: income rows in category Proventos,
 * not attached to a holding. October was record_dividend, which already
 * has the cash leg. This script is only for the unlinked rows.
 *
 * Dry run (default) prints the plan and writes nothing:
 *
 *   pnpm --filter @wallex/capital exec tsx scripts/link-plain-proventos.ts
 *   pnpm --filter @wallex/capital exec tsx scripts/link-plain-proventos.ts --user <userId>
 *
 * Apply against the database in DATABASE_URL (the app refuses a production
 * database unless CAPITAL_ALLOW_PROD_DB=1, and this script still refuses
 * that override — do not point it at production):
 *
 *   pnpm --filter @wallex/capital exec tsx scripts/link-plain-proventos.ts --apply
 *
 * One row, by hand, with the MCP tools:
 *   1. list_transactions for the income (kind income, category Proventos).
 *   2. list_holdings and take the holdingId of the ticker in the description.
 *   3. convert_income_to_dividend with that transactionId, holdingId and
 *      incomeType fii_income (ticker ending 11), dividend, or
 *      fixed_income_interest. The entry becomes the cash leg. Do not call
 *      record_dividend: that would credit the same net a second time.
 */
import { Prisma } from "../src/generated/prisma";
import { prisma } from "../src/server/lib/prisma";
import { planPlainProventoLinks, type PlainProventoHolding, type PlainProventoIncome } from "../src/server/modules/investments/lib/link-plain-proventos";
import { convertIncomeToDividend } from "../src/server/modules/investments/services/dividends";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  if (process.env.CAPITAL_ALLOW_PROD_DB === "1") {
    throw new Error("Refusing to run with CAPITAL_ALLOW_PROD_DB set. This script does not target production.");
  }
  const apply = process.argv.includes("--apply");
  const userId = arg("--user");
  const userFilter = userId ? Prisma.sql`AND le."userId" = ${userId}` : Prisma.empty;
  const holdingUser = userId ? Prisma.sql`AND a."userId" = ${userId}` : Prisma.empty;
  const incomes = await prisma.$queryRaw<PlainProventoIncome[]>`
    SELECT le.id, le.description, le."entityId", le."accountId",
           c.name AS "categoryName", c."systemKey" AS "categorySystemKey",
           le.amount::float8 AS amount, to_char(le.date, 'YYYY-MM-DD') AS date
    FROM ledger_entries le
    JOIN categories c ON c.id = le."categoryId"
    WHERE le."deletedAt" IS NULL
      AND le.kind = 'income'
      AND le."transferGroupId" IS NULL
      AND le.amount > 0
      AND (lower(btrim(c.name)) IN ('proventos', 'rendimentos') OR c."systemKey" IN ('dividends', 'interest'))
      AND NOT EXISTS (SELECT 1 FROM investment_operations o WHERE o."cashEntryId" = le.id)
      ${userFilter}
  `;
  const holdings = await prisma.$queryRaw<PlainProventoHolding[]>`
    SELECT h.id, h.ticker, h.name, a."entityId", h."accountId"
    FROM investment_holdings h
    JOIN accounts a ON a.id = h."accountId"
    WHERE true
      ${holdingUser}
  `;
  const plan = planPlainProventoLinks(incomes, holdings);
  console.log(JSON.stringify({ apply, candidates: incomes.length, links: plan.links, skipped: plan.skipped }, null, 2));
  if (!apply) {
    console.log("Dry run. Re-run with --apply to call convert_income_to_dividend. Nothing was written.");
    return;
  }
  const owners = await prisma.ledgerEntry.findMany({
    where: { id: { in: plan.links.map((l) => l.transactionId) } },
    select: { id: true, userId: true },
  });
  const userOf = new Map(owners.map((row) => [row.id, row.userId]));
  for (const link of plan.links) {
    const owner = userOf.get(link.transactionId);
    if (!owner) throw new Error(`Missing entry ${link.transactionId}`);
    const result = await convertIncomeToDividend(
      owner,
      { transactionId: link.transactionId, holdingId: link.holdingId, incomeType: link.incomeType },
      prisma,
    );
    console.log(`linked ${link.transactionId} ${link.ticker} ${link.incomeType} -> operation ${result.operationId} duplicate=${result.duplicate}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
