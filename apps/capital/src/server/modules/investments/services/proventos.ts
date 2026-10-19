import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AllocationClass, AssetClass, DividendOrigin, EntityType, IncomeType, InvestmentTransactionType } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { entityScopeSql, entityScopeWhere } from "@capital/server/lib/entity-scope";
import { countsAsPassiveIncome, unmatchedPassiveIncome } from "@/lib/invest/passive-income";
import { holdingAllocationClass } from "../lib/allocation-class";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";

const YEAR = 365 * 86_400_000;
const WEEK = 7 * 86_400_000;

/**
 * One row of Proventos 12m: a dividend or yield operation (including on an
 * inactive holding), or ledger income in category "Proventos" / system key
 * "dividends" that no such operation already counted. A transfer never
 * qualifies. The operation's own cash leg does not qualify a second time.
 * `amountBase` is the net in the base currency at the rate stored on the
 * cash leg (or the rate of the operation's date when it has no leg).
 * Archived accounts are out. `source: "ledger"` rows are not operations
 * and cannot be deleted as one.
 */
export interface ProventoRow {
  id: string;
  source: "operation" | "ledger";
  holdingId: string | null;
  ticker: string | null;
  name: string | null;
  assetClass: AssetClass | null;
  allocationClass: AllocationClass | null;
  dividendOrigin: DividendOrigin | null;
  entityKind: EntityType | null;
  accountId: string | null;
  entityId: string | null;
  currency: string;
  type: Extract<InvestmentTransactionType, "dividend" | "yield_payment">;
  incomeType: IncomeType | null;
  quantity: number | null;
  totalAmount: number;
  taxWithheld: number;
  /** Net in the base currency, at the stored rate. */
  amountBase: number;
  /** Gross in the base currency. */
  grossBase: number;
  /** Withholding in the base currency. */
  taxBase: number;
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
        dividendOrigin: true,
        quantity: true,
        totalAmount: true,
        taxWithheld: true,
        date: true,
        cashEntryId: true,
        cashEntry: { select: { amountBase: true, deletedAt: true } },
        holding: {
          select: {
            ticker: true,
            name: true,
            assetClass: true,
            allocationClass: true,
            currency: true,
            accountId: true,
            account: { select: { entityId: true, entity: { select: { kind: true } } } },
          },
        },
      },
    }),
    db.$queryRaw<
      { id: string; date: Date; amountBase: Prisma.Decimal; description: string | null; entityId: string; accountId: string; entityKind: EntityType }[]
    >`
      SELECT le.id, le.date, le."amountBase", le.description, le."entityId", le."accountId", e.kind AS "entityKind"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a."archivedAt" IS NULL
      JOIN entities e ON e.id = le."entityId"
      JOIN categories c ON c.id = le."categoryId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'income'
        AND le."transferGroupId" IS NULL
        AND le.amount > 0
        AND le.date >= ${matchFrom}
        AND (c.name = 'Proventos' OR c."systemKey" = 'dividends')
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    `,
  ]);

  const bases = new Map(operations.map((op) => [op.id, operationBases(op, fx)]));
  const unmatched = new Set(
    unmatchedPassiveIncome(
      operations.map((op) => {
        const base = bases.get(op.id)!;
        return { id: op.id, at: op.date.getTime(), netBase: base.net, grossBase: base.gross, cashEntryId: op.cashEntryId };
      }),
      entries.map((e) => ({ id: e.id, at: e.date.getTime(), base: toNumber(e.amountBase), transfer: false })),
    ),
  );

  const rows: ProventoRow[] = [];
  let total = 0;
  for (const op of operations) {
    if (op.date < yearAgo) continue;
    const entityKind = op.holding.account.entity.kind;
    if (!countsAsPassiveIncome({ entityKind, incomeType: op.incomeType })) continue;
    const base = bases.get(op.id)!;
    total += base.net;
    rows.push({
      id: op.id,
      source: "operation",
      holdingId: op.holdingId,
      ticker: op.holding.ticker,
      name: op.holding.name,
      assetClass: op.holding.assetClass,
      allocationClass: holdingAllocationClass(op.holding),
      dividendOrigin: op.dividendOrigin,
      entityKind,
      accountId: op.holding.accountId,
      entityId: op.holding.account.entityId,
      currency: op.holding.currency,
      type: op.type as ProventoRow["type"],
      incomeType: op.incomeType,
      quantity: op.quantity,
      totalAmount: op.totalAmount,
      taxWithheld: op.taxWithheld,
      amountBase: base.net,
      grossBase: base.gross,
      taxBase: base.tax,
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
      assetClass: null,
      allocationClass: null,
      dividendOrigin: null,
      entityKind: entry.entityKind,
      accountId: entry.accountId,
      entityId: entry.entityId,
      currency: fx.baseCurrency,
      type: "dividend",
      incomeType: null,
      quantity: null,
      totalAmount: base,
      taxWithheld: 0,
      amountBase: base,
      grossBase: base,
      taxBase: 0,
      date: formatDateOnly(entry.date),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { total: round(total, 2), rows };
}

/** Net, gross and tax in the base currency. The cash leg's stored amount wins over the rate of the day, which wins over today's rate. */
function operationBases(
  op: {
    totalAmount: number;
    taxWithheld: number;
    date: Date;
    cashEntry: { amountBase: Prisma.Decimal; deletedAt: Date | null } | null;
    holding: { currency: string };
  },
  fx: { rateOn(currency: string, date: Date): number },
): { net: number; gross: number; tax: number } {
  const netNative = op.totalAmount - op.taxWithheld;
  const leg = op.cashEntry && !op.cashEntry.deletedAt ? op.cashEntry : null;
  if (leg && Math.abs(netNative) > 1e-9) {
    const net = toNumber(leg.amountBase);
    const gross = net * (op.totalAmount / netNative);
    return { net, gross, tax: gross - net };
  }
  const rate = fx.rateOn(op.holding.currency, op.date);
  return { net: netNative * rate, gross: op.totalAmount * rate, tax: op.taxWithheld * rate };
}
