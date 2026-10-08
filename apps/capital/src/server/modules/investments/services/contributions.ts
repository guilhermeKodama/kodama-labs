import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AllocationClass, AssetClass, TransferDirection } from "@/generated/prisma";
import { entityScopeSql } from "@capital/server/lib/entity-scope";
import { LOCALES, st } from "@capital/server/i18n";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { flowKindJoins, flowKindSql } from "@capital/server/modules/ledger/lib/flow-sql";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { holdingAllocationClass } from "../lib/allocation-class";
import { addMonths, monthEnd, monthStart, parsePeriod, periodLabel, periodOf, periodRange } from "../lib/portfolio-timeline";
import { currentPeriod } from "./portfolio-history";

/**
 * Aportes (GET /v2/contributions): money moved into and out of the brokers
 * month by month, where it went, where it came from, and the savings rate.
 *
 * - deposits / withdrawals / net: the brokerage legs of the transfers whose
 *   flowKind is "invest" (investment_deposit / investment_withdrawal), plus
 *   kind=investment rows on checking or cash with no transfer and no
 *   operation cash leg, unless a brokerage leg in the same entity matches
 *   the base amount within R$ 0.01 and the date within 3 days (money that
 *   left the bank is an aporte, money that arrived is a resgate). Those
 *   rows are only this chart and the savings rate. A caixinha balance is
 *   not a brokerage account, so it is not in Carteira Patrimônio, and the
 *   row is not in Total aportado or Resultado;
 * - byAllocationClass: buys of the month by class (gross amount + fees, at
 *   the rate on the buy's date), excluding a no-cash first operation of the
 *   holding (the same opening-lot rule as the portfolio timeline); the chart
 *   labels that split "Compras". The net bars are deposits − withdrawals.
 *   byAssetClass is the same buys;
 * - origins: each of those transfers, with the account it came from and,
 *   when the aporte crossed entities, the entity the money started in (the
 *   capital injection or profit distribution booked in the same batch);
 * - savingsRate: PF aportes ÷ PF Entradas over the same months. Entradas are
 *   what the Transações KPI counts as income with only PF selected (display
 *   semantics): positive rows that are not aportes, and transfers in from
 *   another entity (profit distributions, pró-labore). Always PF, whatever
 *   the scope.
 */

export interface ContributionOrigin {
  transferGroupId: string;
  /** The brokerage leg. */
  entryId: string;
  date: string;
  /** Into the broker (+) or out of it (−), in the base currency. */
  amount: number;
  direction: TransferDirection;
  description: string | null;
  /** `description` is the text a transfer gets when none is typed ("Aporte em investimento: A → B"), in any language. */
  defaultDescription: boolean;
  brokerAccountId: string;
  brokerAccountName: string;
  brokerEntityName: string;
  /** The other side of the transfer. */
  counterpartAccountName: string | null;
  counterpartEntityName: string | null;
  /**
   * Across entities, the other entity of the same batch: the one the money
   * came from (aporte), or the one it went on to (resgate from a PJ broker
   * into a PF account).
   */
  sourceEntityName: string | null;
  sourceTransferGroupId: string | null;
  /** The description typed on that transfer; null when it has the default one. */
  sourceDescription: string | null;
  /**
   * A checking or cash investment row with no transfer. It counts in the
   * month's net, and it is not a transfer group the Transações drill can open.
   */
  standalone?: boolean;
}

export interface ContributionMonth {
  /** "YYYY-MM" */
  period: string;
  year: number;
  month: number;
  deposits: number;
  withdrawals: number;
  net: number;
  byAllocationClass: Partial<Record<AllocationClass, number>>;
  byAssetClass: Partial<Record<AssetClass, number>>;
  origins: ContributionOrigin[];
}

export interface ContributionsOptions {
  entityIds?: string[] | null;
  /** Calendar year (the months are January to December). */
  year?: number;
  /** Trailing window: `months` months ending in `end` ("YYYY-MM", default the current month). */
  months?: number;
  end?: string;
}

function windowOf(opts: ContributionsOptions, timezone: string): { from: number; to: number } {
  if (opts.year) return { from: opts.year * 100 + 1, to: opts.year * 100 + 12 };
  const to = opts.end ? parsePeriod(opts.end) : currentPeriod(timezone);
  if (to === null) throw new LedgerError("Invalid month", 422, { code: "validation" });
  return { from: addMonths(to, -((opts.months ?? 12) - 1)), to };
}

export async function contributions(userId: string, db: DbClient, opts: ContributionsOptions = {}) {
  const entityIds = opts.entityIds ?? null;
  const [fx, user, pfEntities] = await Promise.all([
    loadFx(userId, db),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    db.entity.findMany({ where: { userId, kind: "personal" }, select: { id: true } }),
  ]);
  const window = windowOf(opts, user.timezone);
  const from = monthStart(window.from);
  const to = monthEnd(window.to);
  const pfIds = pfEntities.map((e) => e.id);

  const legs = await db.$queryRaw<
    {
      id: string;
      transferGroupId: string;
      date: Date;
      amountBase: Prisma.Decimal;
      entityId: string;
      direction: TransferDirection;
      group_description: string | null;
      description: string | null;
      broker_id: string;
      broker_name: string;
      broker_entity: string;
      cp_account: string | null;
      cp_entity: string | null;
    }[]
  >`
    SELECT le.id, le."transferGroupId", le.date, le."amountBase", le."entityId", tg.direction, tg.description AS group_description, le.description,
           a.id AS broker_id, a.name AS broker_name, be.name AS broker_entity, cpa.name AS cp_account, cpe.name AS cp_entity
    FROM ledger_entries le
    JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage'
    JOIN entities be ON be.id = a."entityId"
    ${flowKindJoins()}
    LEFT JOIN LATERAL (SELECT o."accountId", o."entityId" FROM ledger_entries o WHERE o."transferGroupId" = le."transferGroupId" AND o.id <> le.id LIMIT 1) cp ON true
    LEFT JOIN accounts cpa ON cpa.id = cp."accountId"
    LEFT JOIN entities cpe ON cpe.id = cp."entityId"
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le."transferGroupId" IS NOT NULL
      AND le.date >= ${from} AND le.date < ${to}
      AND ${flowKindSql()} = 'invest'
      AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
    ORDER BY le.date DESC, le.id`;

  // The capital injection / profit distribution booked in the same batch as an aporte or resgate across entities.
  const groupIds = [...new Set(legs.map((l) => l.transferGroupId))];
  const sources = groupIds.length
    ? await db.$queryRaw<{ deposit_group: string; source_group: string; source_entity: string; source_description: string | null; source_direction: TransferDirection }[]>`
        SELECT DISTINCT ON (dep."recordId") dep."recordId" AS deposit_group, src.id AS source_group, se.name AS source_entity,
               src.description AS source_description, src.direction AS source_direction
        FROM mutation_records dep
        JOIN mutation_records mr ON mr."batchId" = dep."batchId" AND mr.model = 'TransferGroup' AND mr."recordId" <> dep."recordId" AND mr.before IS NULL
        JOIN transfer_groups src ON src.id = mr."recordId" AND src."deletedAt" IS NULL
          AND src.direction IN ('capital_injection', 'profit_distribution', 'between_accounts')
        JOIN transfer_groups depg ON depg.id = dep."recordId"
        -- An aporte names the entity the money came from; a resgate the one it went on to.
        JOIN ledger_entries src_leg ON src_leg."transferGroupId" = src.id
          AND (CASE WHEN depg.direction = 'investment_withdrawal' THEN src_leg.amount > 0 ELSE src_leg.amount < 0 END)
        JOIN entities se ON se.id = src_leg."entityId"
        WHERE dep.model = 'TransferGroup' AND dep.before IS NULL AND dep."recordId" IN (${Prisma.join(groupIds)})
        ORDER BY dep."recordId", src."createdAt"`
    : [];
  const sourceOf = new Map(sources.map((s) => [s.deposit_group, s]));
  const bankInvestments = await unlinkedBankInvestments(userId, db, entityIds, from, to);

  // Buys by holding class; totalAmount and fees are in the holding's currency.
  // A no-cash first operation of the holding is an opening lot (posição inicial), not a purchase of that month.
  const buys = await db.$queryRaw<{ date: Date; asset_class: AssetClass; allocation_class: AllocationClass | null; currency: string; total: number; opening: boolean }[]>`
    SELECT o.date, h."assetClass"::text AS asset_class, h."allocationClass"::text AS allocation_class, h.currency,
           (o."totalAmount" + o.fees) AS total,
           (cash.id IS NULL AND NOT EXISTS (
             SELECT 1 FROM investment_operations earlier
             WHERE earlier."holdingId" = o."holdingId"
               AND (earlier.date < o.date OR (earlier.date = o.date AND earlier."createdAt" < o."createdAt"))
           )) AS opening
    FROM investment_operations o
    JOIN investment_holdings h ON h.id = o."holdingId"
    JOIN accounts a ON a.id = h."accountId"
    LEFT JOIN ledger_entries cash ON cash.id = o."cashEntryId" AND cash."deletedAt" IS NULL
    WHERE a."userId" = ${userId} AND o.type IN ('buy', 'deposit') AND o.date >= ${from} AND o.date < ${to}
      AND ${entityScopeSql(Prisma.sql`a."entityId"`, entityIds)}`;

  const months: ContributionMonth[] = periodRange(window.from, window.to).map((period) => {
      const inMonth = legs.filter((l) => periodOf(l.date) === period);
      const bankInMonth = bankInvestments.filter((r) => periodOf(r.date) === period);
      let deposits = inMonth.reduce((s, l) => s + Math.max(0, toNumber(l.amountBase)), 0);
      let withdrawals = inMonth.reduce((s, l) => s + Math.max(0, -toNumber(l.amountBase)), 0);
      for (const row of bankInMonth) {
        if (row.amountBase < 0) deposits += -row.amountBase;
        else withdrawals += row.amountBase;
      }
      const byAssetClass: Partial<Record<AssetClass, number>> = {};
      const byAllocationClass: Partial<Record<AllocationClass, number>> = {};
      for (const b of buys) {
        if (b.opening || periodOf(b.date) !== period) continue;
        const base = Number(b.total) * fx.rateOn(b.currency, b.date);
        const cls = holdingAllocationClass({ assetClass: b.asset_class, currency: b.currency, allocationClass: b.allocation_class });
        byAssetClass[b.asset_class] = (byAssetClass[b.asset_class] ?? 0) + base;
        byAllocationClass[cls] = (byAllocationClass[cls] ?? 0) + base;
      }
      return {
        period: periodLabel(period),
        year: Math.floor(period / 100),
        month: period % 100,
        deposits: round(deposits, 2),
        withdrawals: round(withdrawals, 2),
        net: round(deposits - withdrawals, 2),
        byAllocationClass: roundValues(byAllocationClass),
        byAssetClass: roundValues(byAssetClass),
        origins: [
          ...inMonth.map((l) => {
            const source = sourceOf.get(l.transferGroupId);
            const description = l.group_description ?? l.description;
            return {
              transferGroupId: l.transferGroupId,
              entryId: l.id,
              date: l.date.toISOString().slice(0, 10),
              amount: round(toNumber(l.amountBase), 2),
              direction: l.direction,
              description,
              defaultDescription: isDefaultTransferDescription(description, l.direction),
              brokerAccountId: l.broker_id,
              brokerAccountName: l.broker_name,
              brokerEntityName: l.broker_entity,
              counterpartAccountName: l.cp_account,
              counterpartEntityName: l.cp_entity,
              sourceEntityName: source?.source_entity ?? null,
              sourceTransferGroupId: source?.source_group ?? null,
              sourceDescription: source && !isDefaultTransferDescription(source.source_description, source.source_direction) ? source.source_description?.trim() || null : null,
            };
          }),
          ...bankInMonth.map((row) => ({
            transferGroupId: row.id,
            entryId: row.id,
            date: row.date.toISOString().slice(0, 10),
            amount: round(-row.amountBase, 2),
            direction: (row.amountBase < 0 ? "investment_deposit" : "investment_withdrawal") as TransferDirection,
            description: row.description,
            defaultDescription: false,
            brokerAccountId: row.accountId,
            brokerAccountName: row.accountName,
            brokerEntityName: row.entityName,
            counterpartAccountName: null,
            counterpartEntityName: null,
            sourceEntityName: null,
            sourceTransferGroupId: null,
            sourceDescription: null,
            standalone: true,
          })),
        ].sort((a, b) => b.date.localeCompare(a.date) || b.entryId.localeCompare(a.entryId)),
      };
    });

  const totalNet = months.reduce((s, m) => s + m.net, 0);
  return {
    baseCurrency: fx.baseCurrency,
    from: periodLabel(window.from),
    to: periodLabel(window.to),
    ...(opts.year && { year: opts.year }),
    months,
    totalNet: round(totalNet, 2),
    averageMonthly: round(totalNet / months.length, 2),
    savingsRate: await savingsRate(userId, db, pfIds, from, to),
  };
}

/** PF aportes ÷ PF Entradas between two instants (see the module comment). */
export async function savingsRate(userId: string, db: DbClient, pfIds: string[], from: Date, to: Date) {
  if (!pfIds.length) return { aportes: 0, income: 0, rate: null };
  const [row] = await db.$queryRaw<{ aportes: Prisma.Decimal | null; income: Prisma.Decimal | null }[]>`
    WITH sel AS (
      SELECT le.id, le."transferGroupId", le."amountBase", a.type AS account_type, ${flowKindSql()} AS flow_kind
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId"
      ${flowKindJoins()}
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le."entityId" IN (${Prisma.join(pfIds)})
        AND le.date >= ${from} AND le.date < ${to}
    ), counted AS (
      SELECT sel.*, count(*) OVER (PARTITION BY coalesce("transferGroupId", id)) AS legs FROM sel
    )
    SELECT
      sum("amountBase") FILTER (WHERE flow_kind = 'invest' AND "transferGroupId" IS NOT NULL AND account_type = 'brokerage') AS aportes,
      sum("amountBase") FILTER (WHERE flow_kind <> 'invest' AND "amountBase" > 0 AND ("transferGroupId" IS NULL OR legs = 1)) AS income
    FROM counted`;
  const bank = await unlinkedBankInvestments(userId, db, pfIds, from, to);
  const aportes = toNumber(row?.aportes ?? 0) + bank.reduce((s, r) => s + -r.amountBase, 0);
  const income = toNumber(row?.income ?? 0);
  return { aportes: round(aportes, 2), income: round(income, 2), rate: income > 0 ? round(aportes / income, 4) : null };
}

interface BankInvestment {
  id: string;
  date: Date;
  amountBase: number;
  entityId: string;
  description: string | null;
  accountId: string;
  accountName: string;
  entityName: string;
}

const MATCH_MS = 3 * 86_400_000;

/**
 * kind=investment on checking or cash, with no transfer group and no
 * operation pointing at the row. A brokerage leg in the same entity within
 * R$ 0.01 and 3 days already accounts for the money, so that row is left out.
 * Each brokerage leg matches at most one bank row: the closest date, then
 * the closest amount, then the lowest id. Bank rows are matched oldest first.
 */
async function unlinkedBankInvestments(userId: string, db: DbClient, entityIds: string[] | null, from: Date, to: Date): Promise<BankInvestment[]> {
  const matchFrom = new Date(from.getTime() - MATCH_MS);
  const matchTo = new Date(to.getTime() + MATCH_MS);
  const [rows, legs] = await Promise.all([
    db.$queryRaw<{ id: string; date: Date; amountBase: Prisma.Decimal; entityId: string; description: string | null; accountId: string; accountName: string; entityName: string }[]>`
      SELECT le.id, le.date, le."amountBase", le."entityId", le.description, a.id AS "accountId", a.name AS "accountName", e.name AS "entityName"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a.type IN ('checking', 'cash') AND a."archivedAt" IS NULL
      JOIN entities e ON e.id = le."entityId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind = 'investment' AND le."transferGroupId" IS NULL
        AND le.date >= ${from} AND le.date < ${to}
        AND NOT EXISTS (SELECT 1 FROM investment_operations o WHERE o."cashEntryId" = le.id)
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}`,
    db.$queryRaw<{ id: string; entityId: string; date: Date; absBase: Prisma.Decimal }[]>`
      SELECT le.id, le."entityId", le.date, abs(le."amountBase") AS "absBase"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage' AND a."archivedAt" IS NULL
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL
        AND le.date >= ${matchFrom} AND le.date < ${matchTo}
        AND ${entityScopeSql(Prisma.sql`le."entityId"`, entityIds)}
      ORDER BY le.date, le.id`,
  ]);
  const pool = legs.map((leg) => ({ id: leg.id, entityId: leg.entityId, date: leg.date, absBase: toNumber(leg.absBase), taken: false }));
  const ordered = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  const out: BankInvestment[] = [];
  for (const row of ordered) {
    const base = Math.abs(toNumber(row.amountBase));
    let hit: (typeof pool)[number] | null = null;
    let bestGap = Infinity;
    let bestAmount = Infinity;
    for (const leg of pool) {
      if (leg.taken || leg.entityId !== row.entityId) continue;
      const amountGap = Math.abs(leg.absBase - base);
      if (amountGap > 0.01) continue;
      const gap = Math.abs(leg.date.getTime() - row.date.getTime());
      if (gap > MATCH_MS) continue;
      const closer = gap < bestGap || (gap === bestGap && (amountGap < bestAmount || (amountGap === bestAmount && (!hit || leg.id < hit.id))));
      if (!closer) continue;
      hit = leg;
      bestGap = gap;
      bestAmount = amountGap;
    }
    if (hit) {
      hit.taken = true;
      continue;
    }
    out.push({ ...row, amountBase: toNumber(row.amountBase) });
  }
  return out;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a transfer's description is the one createEntry writes when none
 * is typed (ledger.transferDescription, "Aporte em investimento: A → B"), in
 * any locale. Account names may have changed since, so they match anything.
 * An empty description counts as default too.
 */
export function isDefaultTransferDescription(description: string | null | undefined, direction: TransferDirection): boolean {
  const text = description?.trim();
  if (!text) return true;
  return LOCALES.some((locale) => {
    const template = st(locale, "ledger.transferDescription", { direction: st(locale, `ledger.direction.${direction}`), from: "\u0001", to: "\u0001" });
    const pattern = template.split("\u0001").map(escapeRegExp).join(".+");
    return new RegExp(`^${pattern}$`, "s").test(text);
  });
}

function roundValues<K extends string>(sums: Partial<Record<K, number>>): Partial<Record<K, number>> {
  return Object.fromEntries(Object.entries<number | undefined>(sums).map(([k, v]) => [k, round(v ?? 0, 2)])) as Partial<Record<K, number>>;
}

/** GET /v2/contributions (for the client, import type only). */
export type ContributionsResponse = Awaited<ReturnType<typeof contributions>>;
