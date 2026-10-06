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
 *   flowKind is "invest" (investment_deposit / investment_withdrawal);
 * - byAllocationClass: buys of the month by class (gross amount + fees, in
 *   the base currency at today's rates), plus "cash" for the part of the
 *   net aporte that was not spent on buys; byAssetClass the buys only;
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
  /** When the money came from another entity in the same batch (aporte across entities): that entity. */
  sourceEntityName: string | null;
  sourceTransferGroupId: string | null;
  /** The description typed on that transfer; null when it has the default one. */
  sourceDescription: string | null;
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

  // The capital injection / profit distribution booked in the same batch as an aporte across entities.
  const groupIds = [...new Set(legs.map((l) => l.transferGroupId))];
  const sources = groupIds.length
    ? await db.$queryRaw<{ deposit_group: string; source_group: string; source_entity: string; source_description: string | null; source_direction: TransferDirection }[]>`
        SELECT DISTINCT ON (dep."recordId") dep."recordId" AS deposit_group, src.id AS source_group, se.name AS source_entity,
               src.description AS source_description, src.direction AS source_direction
        FROM mutation_records dep
        JOIN mutation_records mr ON mr."batchId" = dep."batchId" AND mr.model = 'TransferGroup' AND mr."recordId" <> dep."recordId" AND mr.before IS NULL
        JOIN transfer_groups src ON src.id = mr."recordId" AND src."deletedAt" IS NULL
          AND src.direction IN ('capital_injection', 'profit_distribution', 'between_accounts')
        JOIN ledger_entries src_out ON src_out."transferGroupId" = src.id AND src_out.amount < 0
        JOIN entities se ON se.id = src_out."entityId"
        WHERE dep.model = 'TransferGroup' AND dep.before IS NULL AND dep."recordId" IN (${Prisma.join(groupIds)})
        ORDER BY dep."recordId", src."createdAt"`
    : [];
  const sourceOf = new Map(sources.map((s) => [s.deposit_group, s]));

  // Buys by holding class; totalAmount and fees are in the holding's currency.
  const buys = await db.$queryRaw<{ period: number; asset_class: AssetClass; allocation_class: AllocationClass | null; currency: string; total: number }[]>`
    SELECT (extract(year FROM o.date) * 100 + extract(month FROM o.date))::int AS period,
           h."assetClass"::text AS asset_class, h."allocationClass"::text AS allocation_class, h.currency,
           sum(o."totalAmount" + o.fees) AS total
    FROM investment_operations o
    JOIN investment_holdings h ON h.id = o."holdingId"
    JOIN accounts a ON a.id = h."accountId"
    WHERE a."userId" = ${userId} AND o.type IN ('buy', 'deposit') AND o.date >= ${from} AND o.date < ${to}
      AND ${entityScopeSql(Prisma.sql`a."entityId"`, entityIds)}
    GROUP BY 1, 2, 3, 4`;

  const months: ContributionMonth[] = periodRange(window.from, window.to).map((period) => {
      const inMonth = legs.filter((l) => periodOf(l.date) === period);
      const deposits = inMonth.reduce((s, l) => s + Math.max(0, toNumber(l.amountBase)), 0);
      const withdrawals = inMonth.reduce((s, l) => s + Math.max(0, -toNumber(l.amountBase)), 0);
      const byAssetClass: Partial<Record<AssetClass, number>> = {};
      const byAllocationClass: Partial<Record<AllocationClass, number>> = {};
      let bought = 0;
      for (const b of buys) {
        if (b.period !== period) continue;
        const base = Number(b.total) * fx.rateFor(b.currency);
        const cls = holdingAllocationClass({ assetClass: b.asset_class, currency: b.currency, allocationClass: b.allocation_class });
        byAssetClass[b.asset_class] = (byAssetClass[b.asset_class] ?? 0) + base;
        byAllocationClass[cls] = (byAllocationClass[cls] ?? 0) + base;
        bought += base;
      }
      const unspent = deposits - withdrawals - bought;
      if (unspent > 0.005) byAllocationClass.cash = (byAllocationClass.cash ?? 0) + unspent;
      return {
        period: periodLabel(period),
        year: Math.floor(period / 100),
        month: period % 100,
        deposits: round(deposits, 2),
        withdrawals: round(withdrawals, 2),
        net: round(deposits - withdrawals, 2),
        byAllocationClass: roundValues(byAllocationClass),
        byAssetClass: roundValues(byAssetClass),
        origins: inMonth.map((l) => {
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
  const aportes = toNumber(row?.aportes ?? 0);
  const income = toNumber(row?.income ?? 0);
  return { aportes: round(aportes, 2), income: round(income, 2), rate: income > 0 ? round(aportes / income, 4) : null };
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
