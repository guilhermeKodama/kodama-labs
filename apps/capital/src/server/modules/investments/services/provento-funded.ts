import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { entityScopeSql } from "@capital/server/lib/entity-scope";
import { unmatchedPassiveIncome } from "@/lib/invest/passive-income";
import { flowKindJoins, flowKindSql } from "@capital/server/modules/ledger/lib/flow-sql";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { proventoFundedPurchases, type AporteCashEvent, type ProventoFundedPurchase } from "../lib/provento-funded";

export interface BrokerageCashAporte extends ProventoFundedPurchase {
  entityId: string;
  accountName: string;
  entityName: string;
}

interface AccountMeta {
  entityId: string;
  accountName: string;
  entityName: string;
}

/**
 * Purchases paid with provento cash held at a broker, up to `to` (exclusive).
 * The walk starts at the beginning of the account so a provento received
 * before the window can fund a purchase inside it, and one already spent
 * cannot fund another. See lib/provento-funded.ts.
 */
export async function brokerageCashAportes(userId: string, db: DbClient, entityIds: string[] | null, to: Date): Promise<BrokerageCashAporte[]> {
  const [operations, legs, ledgerIncome] = await Promise.all([
    db.$queryRaw<
      {
        id: string;
        date: Date;
        type: string;
        totalAmount: number;
        taxWithheld: number;
        ticker: string | null;
        name: string;
        accountId: string;
        entityId: string;
        accountName: string;
        entityName: string;
        amountBase: Prisma.Decimal;
        cashEntryId: string;
        fundedBase: Prisma.Decimal | null;
      }[]
    >`
      SELECT o.id, o.date, o.type::text AS type, o."totalAmount", o."taxWithheld",
             h.ticker, h.name,
             cash."accountId", cash."entityId", cash."amountBase", cash.id AS "cashEntryId",
             a.name AS "accountName", e.name AS "entityName",
             fund."amountBase" AS "fundedBase"
      FROM investment_operations o
      JOIN investment_holdings h ON h.id = o."holdingId"
      JOIN ledger_entries cash ON cash.id = o."cashEntryId" AND cash."deletedAt" IS NULL
      JOIN accounts a ON a.id = cash."accountId" AND a.type = 'brokerage'
      JOIN entities e ON e.id = cash."entityId"
      LEFT JOIN LATERAL (
        SELECT fl."amountBase"
        FROM ledger_entries fl
        WHERE o."fundingGroupId" IS NOT NULL
          AND fl."transferGroupId" = o."fundingGroupId"
          AND fl."accountId" = cash."accountId"
          AND fl."deletedAt" IS NULL
          AND fl."amountBase" > 0
        ORDER BY fl.id
        LIMIT 1
      ) fund ON true
      WHERE a."userId" = ${userId} AND o.date < ${to}
        AND o.type::text IN ('buy', 'deposit', 'sell', 'withdrawal', 'dividend', 'yield_payment')
        AND ${entityScopeSql(Prisma.sql`cash."entityId"`, entityIds)}`,
    db.$queryRaw<{ id: string; date: Date; amountBase: Prisma.Decimal; accountId: string }[]>`
      SELECT le.id, le.date, le."amountBase", le."accountId"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage'
      ${flowKindJoins()}
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le."transferGroupId" IS NOT NULL
        AND le.date < ${to}
        AND ${flowKindSql()} = 'invest'
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}`,
    db.$queryRaw<{ id: string; date: Date; amountBase: Prisma.Decimal; accountId: string; entityId: string; accountName: string; entityName: string; description: string | null }[]>`
      SELECT le.id, le.date, le."amountBase", le."accountId", le."entityId", le.description,
             a.name AS "accountName", e.name AS "entityName"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage'
      JOIN entities e ON e.id = le."entityId"
      JOIN categories c ON c.id = le."categoryId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'income'
        AND le."transferGroupId" IS NULL AND le.amount > 0 AND le.date < ${to}
        AND (c.name = 'Proventos' OR c."systemKey" = 'dividends')
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}`,
  ]);

  const accounts = new Map<string, AccountMeta>();
  const remember = (accountId: string, meta: AccountMeta) => {
    if (!accounts.has(accountId)) accounts.set(accountId, meta);
  };

  const events: AporteCashEvent[] = [];
  const incomeOps: { id: string; at: number; netBase: number; grossBase: number; cashEntryId: string | null }[] = [];
  for (const op of operations) {
    remember(op.accountId, { entityId: op.entityId, accountName: op.accountName, entityName: op.entityName });
    const base = toNumber(op.amountBase);
    const day = formatDateOnly(op.date);
    if (op.type === "dividend" || op.type === "yield_payment") {
      if (base <= 0) continue;
      const netNative = op.totalAmount - op.taxWithheld;
      const grossBase = Math.abs(netNative) > 1e-9 ? base * (op.totalAmount / netNative) : base;
      incomeOps.push({ id: op.id, at: op.date.getTime(), netBase: base, grossBase, cashEntryId: op.cashEntryId });
      events.push({ id: op.id, accountId: op.accountId, entityId: op.entityId, date: day, amount: base, kind: "income" });
      continue;
    }
    if (op.type === "sell" || op.type === "withdrawal") {
      if (base <= 0) continue;
      events.push({ id: op.id, accountId: op.accountId, entityId: op.entityId, date: day, amount: base, kind: "sale" });
      continue;
    }
    const spent = Math.abs(base);
    if (spent <= 0) continue;
    const fundedBase = op.fundedBase === null ? 0 : toNumber(op.fundedBase);
    events.push({
      id: op.id,
      accountId: op.accountId,
      entityId: op.entityId,
      date: day,
      amount: spent,
      kind: "purchase",
      funded: Math.min(spent, Math.max(fundedBase, 0)),
      label: op.ticker?.trim() || op.name,
    });
  }

  for (const leg of legs) {
    const base = toNumber(leg.amountBase);
    if (base === 0) continue;
    events.push({
      id: leg.id,
      accountId: leg.accountId,
      date: formatDateOnly(leg.date),
      amount: Math.abs(base),
      kind: base > 0 ? "deposit" : "withdrawal",
    });
  }

  const unmatched = new Set(
    unmatchedPassiveIncome(
      incomeOps,
      ledgerIncome.map((entry) => ({ id: entry.id, at: entry.date.getTime(), base: toNumber(entry.amountBase), transfer: false })),
    ),
  );
  for (const entry of ledgerIncome) {
    if (!unmatched.has(entry.id)) continue;
    const base = toNumber(entry.amountBase);
    if (base <= 0) continue;
    remember(entry.accountId, { entityId: entry.entityId, accountName: entry.accountName, entityName: entry.entityName });
    events.push({
      id: entry.id,
      accountId: entry.accountId,
      entityId: entry.entityId,
      date: formatDateOnly(entry.date),
      amount: base,
      kind: "income",
    });
  }

  return proventoFundedPurchases(events).flatMap((row) => {
    const meta = accounts.get(row.accountId);
    if (!meta) return [];
    return [{ ...row, entityId: meta.entityId, accountName: meta.accountName, entityName: meta.entityName }];
  });
}
