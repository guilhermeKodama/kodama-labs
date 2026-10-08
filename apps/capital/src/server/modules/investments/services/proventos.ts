import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AllocationClass, IncomeType, InvestmentTransactionType } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { entityScopeSql, entityScopeWhere } from "@capital/server/lib/entity-scope";
import { holdingAllocationClass } from "../lib/allocation-class";
import { unmatchedProventos } from "../lib/proventos";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";

const YEAR = 365 * 86_400_000;
const WEEK = 7 * 86_400_000;

/**
 * One row of Proventos 12m: a dividend or yield operation (including on an
 * inactive holding), or ledger income in category "Proventos" / system key
 * "dividends" that no such operation already counted. Archived accounts are
 * out. `source: "ledger"` rows are not operations and cannot be deleted as one.
 */
export interface ProventoRow {
  id: string;
  source: "operation" | "ledger";
  holdingId: string | null;
  ticker: string | null;
  name: string | null;
  allocationClass: AllocationClass | null;
  accountId: string | null;
  entityId: string | null;
  currency: string;
  type: Extract<InvestmentTransactionType, "dividend" | "yield_payment">;
  incomeType: IncomeType | null;
  quantity: number | null;
  totalAmount: number;
  taxWithheld: number;
  date: string;
}

export async function proventos12m(userId: string, db: DbClient, entityIds: string[] | null = null): Promise<{ total: number; rows: ProventoRow[] }> {
  const fx = await loadFx(userId, db);
  const yearAgo = new Date(Date.now() - YEAR);
  const matchFrom = new Date(yearAgo.getTime() - WEEK);
  const scope = entityScopeWhere(entityIds);

  const [operations, entries] = await Promise.all([
    db.investmentOperation.findMany({
      where: {
        holding: { account: { userId, archivedAt: null, ...scope } },
        type: { in: ["dividend", "yield_payment"] },
        date: { gte: matchFrom },
      },
      select: {
        id: true,
        holdingId: true,
        type: true,
        incomeType: true,
        quantity: true,
        totalAmount: true,
        taxWithheld: true,
        date: true,
        holding: {
          select: {
            ticker: true,
            name: true,
            assetClass: true,
            allocationClass: true,
            currency: true,
            accountId: true,
            account: { select: { entityId: true } },
          },
        },
      },
    }),
    db.$queryRaw<
      { id: string; date: Date; amountBase: Prisma.Decimal; description: string | null; entityId: string; accountId: string }[]
    >`
      SELECT le.id, le.date, le."amountBase", le.description, le."entityId", le."accountId"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a."archivedAt" IS NULL
      JOIN categories c ON c.id = le."categoryId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'income'
        AND le.date >= ${matchFrom}
        AND (c.name = 'Proventos' OR c."systemKey" = 'dividends')
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    `,
  ]);

  const opBase = (op: (typeof operations)[number]) => (op.totalAmount - op.taxWithheld) * fx.rateOn(op.holding.currency, op.date);
  const unmatched = new Set(
    unmatchedProventos(
      operations.map((op) => ({ id: op.id, at: op.date.getTime(), base: opBase(op) })),
      entries.map((e) => ({ id: e.id, at: e.date.getTime(), base: toNumber(e.amountBase) })),
    ),
  );

  const rows: ProventoRow[] = [];
  let total = 0;
  for (const op of operations) {
    if (op.date < yearAgo) continue;
    const base = opBase(op);
    total += base;
    rows.push({
      id: op.id,
      source: "operation",
      holdingId: op.holdingId,
      ticker: op.holding.ticker,
      name: op.holding.name,
      allocationClass: holdingAllocationClass(op.holding),
      accountId: op.holding.accountId,
      entityId: op.holding.account.entityId,
      currency: op.holding.currency,
      type: op.type as ProventoRow["type"],
      incomeType: op.incomeType,
      quantity: op.quantity,
      totalAmount: op.totalAmount,
      taxWithheld: op.taxWithheld,
      date: formatDateOnly(op.date),
    });
  }
  for (const entry of entries) {
    if (!unmatched.has(entry.id) || entry.date < yearAgo) continue;
    const base = toNumber(entry.amountBase);
    total += base;
    rows.push({
      id: entry.id,
      source: "ledger",
      holdingId: null,
      ticker: null,
      name: entry.description,
      allocationClass: null,
      accountId: entry.accountId,
      entityId: entry.entityId,
      currency: fx.baseCurrency,
      type: "dividend",
      incomeType: null,
      quantity: null,
      totalAmount: base,
      taxWithheld: 0,
      date: formatDateOnly(entry.date),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { total: round(total, 2), rows };
}
