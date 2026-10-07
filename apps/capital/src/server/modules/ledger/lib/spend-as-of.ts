import { Prisma } from "@/generated/prisma";

/**
 * When an expense counts as spent.
 *
 * A card purchase counts on its purchase date (`date`); everything else
 * counts on its effective date. The month it belongs to stays the effective
 * date, so a card purchase still lands in the statement's month — it just
 * stops waiting for the closing day before Orçamentos calls it spent.
 *
 * Callers (keep them on these helpers so the cutoff cannot drift):
 * spendBySlot and the pace series and the year cell (budget-overview.ts),
 * the Transações drill (`{ field: "spentToDate", op: "asOf" }` in
 * query-engine.ts), and the budget push (notify.ts).
 */

function alias(name: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid SQL alias "${name}"`);
  return Prisma.raw(name);
}

/** Purchase date for a card row, effective date otherwise. */
export function economicDateSql(table: string): Prisma.Sql {
  const a = alias(table);
  return Prisma.sql`(CASE WHEN ${a}."cardStatementId" IS NOT NULL THEN ${a}.date ELSE ${a}."effectiveDate" END)`;
}

/** The row's economic date is on or before `asOf` (inclusive). */
export function spentToDateSql(table: string, asOf: Date): Prisma.Sql {
  return Prisma.sql`${economicDateSql(table)} <= ${asOf}`;
}

/**
 * Day of the month the pace chart plots the row on. A card purchase from
 * the previous cycle (economic date before this month) lands on day 1,
 * already spent when the month opens.
 */
export function paceDaySql(table: string, monthStart: Date): Prisma.Sql {
  const economic = economicDateSql(table);
  return Prisma.sql`(CASE WHEN ${economic} < ${monthStart} THEN 1 ELSE extract(day FROM ${economic})::int END)`;
}
