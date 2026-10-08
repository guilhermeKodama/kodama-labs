import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AllocationClass } from "@/generated/prisma";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { trailingReturn, type TrailingReturn } from "@/lib/invest/dietz";
import { ALLOCATION_CLASSES, holdingAllocationClass } from "../lib/allocation-class";
import { AMOUNT_BASED } from "../lib/holding-value";
import {
  addMonths,
  buildTimeline,
  monthEnd,
  periodLabel,
  periodRange,
  type MonthState,
  type PortfolioTimeline,
  type TimelineInput,
  type TimelineOperation,
} from "../lib/portfolio-timeline";

/**
 * Portfolio history: PortfolioSnapshot rows (one per entity and month) and
 * GET /v2/portfolio/history.
 *
 * Cash, cost basis, "Total aportado" and the monthly flow always come from
 * the ledger (lib/portfolio-timeline.ts), so a back-dated entry shows up in
 * past months too. What the ledger cannot rebuild is the market value of
 * the holdings at a past month end: the snapshot keeps it. The daily cron
 * stores the live month at today's prices and closes the previous month;
 * a month with no real snapshot is valued at cost and flagged `estimated`
 * (the backfill writes those rows on purpose, so the history starts full).
 *
 * The portfolio is the same population everywhere ("Patrimônio", "Total
 * aportado", "Resultado", the history chart): brokerage accounts that are
 * not archived and the active holdings of accounts that are not archived
 * (PORTFOLIO_HOLDINGS / PORTFOLIO_BROKERS). An archived broker leaves with
 * its cash and every flow into or out of it; money moved from an archived
 * broker into a live one is, for the live population, money coming in. A
 * deactivated holding counted while it was held and left the portfolio
 * when it was deactivated (its `updatedAt`, see `removedAt` in
 * lib/portfolio-timeline.ts): what it still held goes out at cost then, so
 * the cash spent on it is not read as a loss and a closed position keeps
 * its realized gain. So Resultado = Patrimônio − Total aportado never mixes
 * what is counted on one side and not on the other.
 */

/** Holdings counted in the portfolio: active, on an account that is not archived. */
export const PORTFOLIO_HOLDINGS = { isActive: true, account: { archivedAt: null } } as const;
/** Brokerage accounts counted in the portfolio: not archived. */
export const PORTFOLIO_BROKERS = { type: "brokerage", archivedAt: null } as const;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadedTimeline {
  timeline: PortfolioTimeline;
  fx: FxContext;
  timezone: string;
}

/** The ledger rows `buildTimeline` reads, plus the names the repair report prints. */
export interface PortfolioTimelineSource {
  fx: FxContext;
  timezone: string;
  input: TimelineInput;
  accountNames: Map<string, string>;
  accountCreatedAt: Map<string, Date>;
  holdingAccountIds: Map<string, string>;
}

export async function loadPortfolioTimelineSource(userId: string, db: DbClient): Promise<PortfolioTimelineSource> {
  const [fx, user, accounts, entries, holdings] = await Promise.all([
    loadFx(userId, db),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    db.account.findMany({ where: { userId, ...PORTFOLIO_BROKERS }, select: { id: true, name: true, entityId: true, currency: true, initialBalance: true, createdAt: true } }),
    db.$queryRaw<{ accountId: string; date: Date; amount: Prisma.Decimal; amountBase: Prisma.Decimal; transferGroupId: string | null }[]>`
      SELECT le."accountId", le.date, le.amount, le."amountBase", le."transferGroupId"
      FROM ledger_entries le
      JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage' AND a."archivedAt" IS NULL
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL`,
    // Deactivated ones too: they count until they were removed (removedAt).
    db.investmentHolding.findMany({
      where: { account: { userId, ...PORTFOLIO_HOLDINGS.account } },
      select: {
        id: true,
        isActive: true,
        updatedAt: true,
        assetClass: true,
        allocationClass: true,
        currency: true,
        createdAt: true,
        currentQuantity: true,
        currentPrice: true,
        totalInvested: true,
        account: { select: { id: true, entityId: true } },
        operations: {
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            type: true,
            quantity: true,
            pricePerUnit: true,
            totalAmount: true,
            fees: true,
            date: true,
            adjustmentMode: true,
            cashEntry: { select: { deletedAt: true, amountBase: true, account: { select: { type: true } } } },
          },
        },
      },
    }),
  ]);
  const firstEntry = new Map<string, Date>();
  for (const e of entries) {
    const d = firstEntry.get(e.accountId);
    if (!d || e.date < d) firstEntry.set(e.accountId, e.date);
  }
  const openedAtOf = new Map(accounts.map((a) => {
    const first = firstEntry.get(a.id);
    return [a.id, first && first < a.createdAt ? first : a.createdAt] as const;
  }));
  const input: TimelineInput = {
    rateFor: (c) => fx.rateFor(c),
    rateOn: (c, date) => fx.rateOn(c, date),
    accounts: accounts.map((a) => ({ id: a.id, entityId: a.entityId, currency: a.currency, initialBalance: toNumber(a.initialBalance), openedAt: openedAtOf.get(a.id)! })),
    entries: entries.map((e) => ({ accountId: e.accountId, date: e.date, amount: toNumber(e.amount), amountBase: toNumber(e.amountBase), isTransfer: e.transferGroupId !== null })),
    holdings: holdings.map((h) => ({
      id: h.id,
      entityId: h.account.entityId,
      assetClass: h.assetClass,
      allocationClass: holdingAllocationClass(h),
      currency: h.currency,
      createdAt: h.createdAt,
      openedAt: openedAtOf.get(h.account.id) ?? h.createdAt,
      currentQuantity: h.currentQuantity,
      currentPrice: h.currentPrice,
      totalInvested: h.totalInvested,
      removedAt: h.isActive ? null : h.updatedAt,
      operations: h.operations.map((op): TimelineOperation => {
        const leg = op.cashEntry && !op.cashEntry.deletedAt ? op.cashEntry : null;
        return {
          id: op.id,
          type: op.type,
          quantity: op.quantity,
          pricePerUnit: op.pricePerUnit,
          totalAmount: op.totalAmount,
          fees: op.fees,
          adjustmentMode: op.adjustmentMode,
          date: op.date,
          cash: !leg ? "none" : leg.account.type === "brokerage" ? "broker" : "outside",
          outsideAmountBase: leg && leg.account.type !== "brokerage" ? toNumber(leg.amountBase) : 0,
        };
      }),
    })),
  };
  return {
    fx,
    timezone: user.timezone,
    input,
    accountNames: new Map(accounts.map((a) => [a.id, a.name])),
    accountCreatedAt: new Map(accounts.map((a) => [a.id, a.createdAt])),
    holdingAccountIds: new Map(holdings.map((h) => [h.id, h.account.id])),
  };
}

export async function loadTimeline(userId: string, db: DbClient): Promise<LoadedTimeline> {
  const source = await loadPortfolioTimelineSource(userId, db);
  return { timeline: buildTimeline(source.input), fx: source.fx, timezone: source.timezone };
}

/** The current month (YYYYMM) in the user's timezone. */
export function currentPeriod(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part("year") * 100 + part("month");
}

/** Whether valuing the month at cost is a guess: some position has (or needs) a market price. */
export function isEstimate(state: MonthState): boolean {
  return state.positions.some((p) => !(AMOUNT_BASED.includes(p.holding.assetClass) && p.holding.currentPrice === null));
}

// ---------------------------------------------------------------------------
// Snapshot rows
// ---------------------------------------------------------------------------

export interface SnapshotFigures {
  marketValueBase: number;
  cashBase: number;
  costBasisBase: number;
  contributedBase: number;
  netFlowBase: number;
  byClass: Record<AllocationClass, number>;
  estimated: boolean;
}

function figures(state: MonthState, value: { marketValue: number; byClass: Record<AllocationClass, number> }, estimated: boolean): SnapshotFigures {
  return {
    marketValueBase: value.marketValue,
    cashBase: state.cash,
    costBasisBase: state.costBasis,
    contributedBase: state.contributed,
    netFlowBase: state.netFlow,
    byClass: value.byClass,
    estimated,
  };
}

const r4 = (n: number) => round(n, 4);
const roundClasses = (byClass: Record<AllocationClass, number>) => Object.fromEntries(ALLOCATION_CLASSES.map((c) => [c, round(byClass[c] ?? 0, 2)])) as Record<AllocationClass, number>;

async function upsertSnapshot(db: DbClient, userId: string, entityId: string, period: number, asOf: Date, f: SnapshotFigures) {
  const data = {
    asOf,
    marketValueBase: r4(f.marketValueBase),
    cashBase: r4(f.cashBase),
    costBasisBase: r4(f.costBasisBase),
    contributedBase: r4(f.contributedBase),
    netFlowBase: r4(f.netFlowBase),
    byClass: roundClasses(f.byClass),
    estimated: f.estimated,
  };
  await db.portfolioSnapshot.upsert({ where: { userId_entityId_period: { userId, entityId, period } }, create: { userId, entityId, period, ...data }, update: data });
}

type StoredSnapshot = { entityId: string; period: number; asOf: Date; marketValueBase: Prisma.Decimal; cashBase: Prisma.Decimal; byClass: Prisma.JsonValue; estimated: boolean };

/** The holdings part of a real snapshot, with today's view of the ledger for the cash. */
function fromStored(state: MonthState, snap: StoredSnapshot): { marketValue: number; byClass: Record<AllocationClass, number> } {
  const stored = (snap.byClass ?? {}) as Partial<Record<AllocationClass, number>>;
  const byClass = Object.fromEntries(ALLOCATION_CLASSES.map((c) => [c, Number(stored[c] ?? 0)])) as Record<AllocationClass, number>;
  byClass.cash += state.cash - toNumber(snap.cashBase);
  return { marketValue: toNumber(snap.marketValueBase), byClass };
}

/** A previous month later than this after its end is closed at cost (estimated) instead of at today's prices. */
const CLOSE_AT_PRICE_DAYS = 3;
const DAY = 86_400_000;

export interface SnapshotUserResult {
  userId: string;
  live: number;
  closed: number;
}

/**
 * The daily snapshot of one user: upserts every entity's live month at
 * today's prices and closes the previous month (once): its ledger figures
 * are taken exactly at the month end; its market value is the last live
 * one, or today's prices right after the turn of the month, or the cost
 * basis (estimated) when the cron missed the month.
 */
export async function snapshotUser(userId: string, db: DbClient, opts: { now?: Date; loaded?: LoadedTimeline } = {}): Promise<SnapshotUserResult> {
  const now = opts.now ?? new Date();
  const { timeline, timezone } = opts.loaded ?? (await loadTimeline(userId, db));
  const current = currentPeriod(timezone, now);
  const previous = addMonths(current, -1);
  const prevEnd = monthEnd(previous);
  const result: SnapshotUserResult = { userId, live: 0, closed: 0 };
  for (const entityId of timeline.entityIds) {
    const first = timeline.firstPeriod(entityId);
    if (first === null || first > current) continue;
    const live = timeline.state(entityId, current);
    await upsertSnapshot(db, userId, entityId, current, now, figures(live, timeline.value(live, "price"), false));
    result.live++;

    if (first > previous) continue;
    const existing = await db.portfolioSnapshot.findUnique({ where: { userId_entityId_period: { userId, entityId, period: previous } } });
    if (existing && existing.asOf.getTime() >= prevEnd.getTime() - 1) continue;
    const state = timeline.state(entityId, previous);
    let closed: SnapshotFigures;
    if (existing && !existing.estimated) closed = figures(state, fromStored(state, existing), false);
    else if (now.getTime() - prevEnd.getTime() <= CLOSE_AT_PRICE_DAYS * DAY) closed = figures(state, timeline.value(state, "price"), false);
    else closed = figures(state, timeline.value(state, "cost"), isEstimate(state));
    await upsertSnapshot(db, userId, entityId, previous, new Date(prevEnd.getTime() - 1), closed);
    result.closed++;
  }
  return result;
}

/** Users with a brokerage account or a holding. */
async function portfolioUsers(db: DbClient, userId?: string): Promise<string[]> {
  const rows = await db.account.findMany({ where: { type: "brokerage", ...(userId && { userId }) }, distinct: ["userId"], select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** The cron: snapshotUser for every user with a portfolio. One failing user does not stop the others. */
export async function runPortfolioSnapshots(db: DbClient, opts: { now?: Date } = {}) {
  const users = await portfolioUsers(db);
  const results: SnapshotUserResult[] = [];
  const errors: { userId: string; error: string }[] = [];
  for (const userId of users) {
    try {
      results.push(await snapshotUser(userId, db, opts));
    } catch (error) {
      errors.push({ userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { users: users.length, live: results.reduce((s, r) => s + r.live, 0), closed: results.reduce((s, r) => s + r.closed, 0), errors };
}

export interface BackfillResult {
  userId: string;
  created: number;
  updated: number;
  kept: number;
}

/**
 * Writes every past month (from the entity's first activity to the month
 * before the current one) that has no real snapshot: cash, cost basis and
 * contributions exactly at the month end from the ledger, the holdings at
 * cost, flagged estimated when that is a guess. Real (not estimated) rows
 * are kept. Then runs snapshotUser for the live month. Idempotent.
 */
export async function backfillSnapshots(db: DbClient, opts: { userId?: string; dryRun?: boolean; now?: Date } = {}): Promise<BackfillResult[]> {
  const now = opts.now ?? new Date();
  const out: BackfillResult[] = [];
  for (const userId of await portfolioUsers(db, opts.userId)) {
    const loaded = await loadTimeline(userId, db);
    const { timeline, timezone } = loaded;
    const current = currentPeriod(timezone, now);
    const res: BackfillResult = { userId, created: 0, updated: 0, kept: 0 };
    const stored = await db.portfolioSnapshot.findMany({ where: { userId }, select: { entityId: true, period: true, estimated: true } });
    const storedBy = new Map(stored.map((s) => [`${s.entityId}:${s.period}`, s]));
    for (const entityId of timeline.entityIds) {
      const first = timeline.firstPeriod(entityId);
      if (first === null) continue;
      for (const period of periodRange(first, addMonths(current, -1))) {
        const existing = storedBy.get(`${entityId}:${period}`);
        if (existing && !existing.estimated) {
          res.kept++;
          continue;
        }
        if (existing) res.updated++;
        else res.created++;
        if (opts.dryRun) continue;
        const state = timeline.state(entityId, period);
        await upsertSnapshot(db, userId, entityId, period, new Date(monthEnd(period).getTime() - 1), figures(state, timeline.value(state, "cost"), isEstimate(state)));
      }
    }
    if (!opts.dryRun) await snapshotUser(userId, db, { now, loaded });
    out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /v2/portfolio/history
// ---------------------------------------------------------------------------

export interface HistoryMonth {
  /** "YYYY-MM" */
  period: string;
  /** Holdings + broker cash ("Patrimônio"). */
  netWorth: number;
  /** Holdings only. */
  marketValue: number;
  cash: number;
  costBasis: number;
  /** "Total aportado" at the month end. */
  contributed: number;
  /**
   * The part of `contributed` that is "posições iniciais": the cost of
   * holdings registered without any operation (typed in when the user
   * started, so there is no date of purchase). The chart shows it apart
   * from the aportes, instead of as an aporte in the month they were typed.
   */
  initialPositions: number;
  /** External flow during the month (aportes − resgates − income paid out of the brokers). */
  netFlow: number;
  byClass: Record<AllocationClass, number>;
  /** The holdings are valued at cost: no snapshot was taken at that month end. */
  estimated: boolean;
  /** Modified Dietz return of the month, or null when it could not be measured. */
  return: number | null;
  /** The current month, valued at today's prices. */
  live: boolean;
}

export interface PortfolioHistory {
  baseCurrency: string;
  from: string;
  to: string;
  months: HistoryMonth[];
  /** Chain-linked Modified Dietz over the months (estimated months left out); `estimated` when every month was left out for being an estimate. */
  return: Omit<TrailingReturn, "monthly" | "estimatedMonths"> & { estimated: boolean };
}

/**
 * The last `months` months (the current one live) for the entities in scope
 * (null = all), summed. One extra month before the window is read as the
 * starting value of the first month's return.
 */
export async function portfolioHistory(userId: string, db: DbClient, opts: { months?: number; entityIds?: string[] | null; loaded?: LoadedTimeline; now?: Date } = {}): Promise<PortfolioHistory> {
  const count = opts.months ?? 12;
  const { timeline, fx, timezone } = opts.loaded ?? (await loadTimeline(userId, db));
  const current = currentPeriod(timezone, opts.now);
  const periods = periodRange(addMonths(current, -count), current);
  const entityIds = timeline.entityIds.filter((id) => !opts.entityIds || opts.entityIds.includes(id));
  const stored = entityIds.length
    ? await db.portfolioSnapshot.findMany({
        where: { userId, entityId: { in: entityIds }, period: { gte: periods[0], lt: current }, estimated: false },
        select: { entityId: true, period: true, asOf: true, marketValueBase: true, cashBase: true, byClass: true, estimated: true },
      })
    : [];
  const storedBy = new Map(stored.map((s) => [`${s.entityId}:${s.period}`, s]));

  const rows = periods.map((period) => {
    const byClass = Object.fromEntries(ALLOCATION_CLASSES.map((c) => [c, 0])) as Record<AllocationClass, number>;
    const sum = { marketValue: 0, cash: 0, costBasis: 0, contributed: 0, initialPositions: 0, netFlow: 0, estimated: false };
    for (const entityId of entityIds) {
      const first = timeline.firstPeriod(entityId);
      if (first === null || first > period) continue;
      const state = timeline.state(entityId, period);
      const snap = storedBy.get(`${entityId}:${period}`);
      let value;
      if (period === current) value = timeline.value(state, "price");
      else if (snap) value = fromStored(state, snap);
      else {
        value = timeline.value(state, "cost");
        sum.estimated ||= isEstimate(state);
      }
      sum.marketValue += value.marketValue;
      sum.cash += state.cash;
      sum.costBasis += state.costBasis;
      sum.contributed += state.contributed;
      sum.initialPositions += state.initialPositions;
      sum.netFlow += state.netFlow;
      for (const c of ALLOCATION_CLASSES) byClass[c] += value.byClass[c];
    }
    return { period, byClass, ...sum };
  });
  const chain = trailingReturn(
    rows.map((r) => ({ period: periodLabel(r.period), value: r.marketValue + r.cash, netFlow: r.netFlow, estimated: r.estimated })),
    { window: count }
  );
  const months: HistoryMonth[] = rows.slice(1).map((r, i) => ({
    period: periodLabel(r.period),
    netWorth: round(r.marketValue + r.cash, 2),
    marketValue: round(r.marketValue, 2),
    cash: round(r.cash, 2),
    costBasis: round(r.costBasis, 2),
    contributed: round(r.contributed, 2),
    initialPositions: round(r.initialPositions, 2),
    netFlow: round(r.netFlow, 2),
    byClass: roundClasses(r.byClass),
    estimated: r.estimated,
    return: chain.monthly[i]?.return ?? null,
    live: r.period === current,
  }));
  return {
    baseCurrency: fx.baseCurrency,
    from: months[0]?.period ?? periodLabel(current),
    to: periodLabel(current),
    months,
    return: {
      value: chain.value,
      months: chain.months,
      from: chain.from,
      to: chain.to,
      // No month could be measured because the window's months are estimates (valued at cost, backfilled before snapshots existed).
      estimated: chain.value === null && chain.estimatedMonths > 0,
    },
  };
}
