import type { AllocationClass, AssetClass } from "@/generated/prisma";
import { ALLOCATION_CLASSES } from "./allocation-class";
import { replayPosition, type PositionOperation } from "./holding-position";
import { marketValue } from "./holding-value";

/**
 * The portfolio of each entity at the end of any month, rebuilt from the
 * ledger: broker cash, cost basis, positions, money contributed and the
 * month's external flow. Pure (the loader is services/portfolio-history.ts),
 * so the snapshot cron, the backfill and GET /v2/portfolio/history share one
 * definition.
 *
 * Money in and out of the portfolio (the "flows"):
 * - transfers into and out of brokerage accounts (aportes, resgates, and
 *   transfers between brokers of different entities), at their amountBase;
 * - a brokerage account's initial balance, when the account opens (its
 *   creation or its first entry, whichever is earlier);
 * - positions registered without cash: an operation with no cash leg (or a
 *   trashed one) brings its cost in (a buy, an adjustment) or takes its
 *   proceeds out (a sale); a holding with no operations at all brings its
 *   cost basis in on the day it was created, as a "posição inicial" (kept
 *   apart in `initialPositions`, so the chart does not read it as an
 *   aporte of that month);
 * - an operation whose cash leg is on a bank account (income credited to
 *   the bank): the money leaves the portfolio.
 *
 * "Total aportado" (contributed) is the running sum of those flows except
 * income paid out to a bank: the money that went into the brokers (opening
 * balances + net aportes + positions registered without cash). The monthly
 * netFlow, used by Modified Dietz, includes income paid out as well, so a
 * dividend credited to the bank still counts as return.
 *
 * Amounts in a foreign currency are converted at today's rates (rateFor),
 * except transfer legs, which keep the amountBase fixed when they were
 * written. Month ends are UTC (dates are stored at noon UTC).
 */

export interface TimelineAccount {
  id: string;
  entityId: string;
  currency: string;
  initialBalance: number;
  /** When the initial balance starts to count: the account's creation or its first entry, whichever is earlier. */
  openedAt: Date;
}

/** A live (not trashed) ledger entry on a brokerage account. */
export interface TimelineEntry {
  accountId: string;
  date: Date;
  amount: number;
  amountBase: number;
  isTransfer: boolean;
}

/** Where an operation's cash went: a leg on a brokerage account, a leg on another account, or no live leg. */
export type OperationCash = "broker" | "outside" | "none";

export interface TimelineOperation extends PositionOperation {
  date: Date;
  cash: OperationCash;
  /** amountBase of the cash leg when it is on another account (cash = "outside"). */
  outsideAmountBase: number;
}

export interface TimelineHolding {
  id: string;
  entityId: string;
  assetClass: AssetClass;
  /** Effective allocation class (override or mapping). */
  allocationClass: AllocationClass;
  currency: string;
  createdAt: Date;
  currentQuantity: number;
  currentPrice: number | null;
  totalInvested: number;
  /** Oldest first. */
  operations: TimelineOperation[];
}

export interface TimelineInput {
  accounts: TimelineAccount[];
  entries: TimelineEntry[];
  holdings: TimelineHolding[];
  /** Base-currency units per unit of `currency`. */
  rateFor(currency: string): number;
}

// ---------------------------------------------------------------------------
// Periods (YYYYMM integers, as PortfolioSnapshot.period)
// ---------------------------------------------------------------------------

export function periodOf(date: Date): number {
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

export function addMonths(period: number, n: number): number {
  const index = Math.floor(period / 100) * 12 + (period % 100) - 1 + n;
  return Math.floor(index / 12) * 100 + (index % 12) + 1;
}

/** First instant of the month. */
export function monthStart(period: number): Date {
  return new Date(Date.UTC(Math.floor(period / 100), (period % 100) - 1, 1));
}

/** First instant of the next month: entries strictly before it belong to the month or earlier. */
export function monthEnd(period: number): Date {
  return new Date(Date.UTC(Math.floor(period / 100), period % 100, 1));
}

/** "YYYY-MM" */
export function periodLabel(period: number): string {
  return `${Math.floor(period / 100)}-${String(period % 100).padStart(2, "0")}`;
}

/** Inverse of periodLabel; null when the text is not a month. */
export function parsePeriod(label: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) * 100 + month : null;
}

/** The periods from `from` to `to`, both included. */
export function periodRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

interface Flow {
  date: Date;
  /** Counts in "Total aportado". */
  contributed: number;
  /** Counts in the month's external flow (Modified Dietz). */
  external: number;
  /** A holding registered without operations ("posições iniciais"). */
  initial?: boolean;
}

interface PositionEvent {
  date: Date;
  quantity: number;
  cost: number;
}

export interface HeldPosition {
  holding: TimelineHolding;
  quantity: number;
  /** Cost basis in the holding's currency. */
  cost: number;
}

export interface MonthState {
  entityId: string;
  period: number;
  /** Broker cash at the month end, in the base currency. */
  cash: number;
  /** Cost basis of the positions held at the month end, in the base currency. */
  costBasis: number;
  /** "Total aportado" up to the month end. */
  contributed: number;
  /** The part of `contributed` brought in by holdings registered without operations ("posições iniciais"). */
  initialPositions: number;
  /** External flow during the month (see the module comment). */
  netFlow: number;
  /** Positions held at the month end. */
  positions: HeldPosition[];
}

export interface HoldingsValue {
  /** Holdings only, in the base currency. */
  marketValue: number;
  /** Holdings by class plus broker cash under "cash", in the base currency. */
  byClass: Record<AllocationClass, number>;
}

const EPS = 1e-9;

function holdingFlows(h: TimelineHolding, rate: number): { flows: Flow[]; events: PositionEvent[] } {
  if (!h.operations.length) {
    // Entered directly (MCP, legacy import): its cost basis came in when it was created.
    const flows = h.totalInvested ? [{ date: h.createdAt, contributed: h.totalInvested * rate, external: h.totalInvested * rate, initial: true }] : [];
    return { flows, events: [{ date: h.createdAt, quantity: h.currentQuantity, cost: h.totalInvested }] };
  }
  const flows: Flow[] = [];
  const events: PositionEvent[] = [];
  let before = replayPosition([]);
  for (let i = 0; i < h.operations.length; i++) {
    const op = h.operations[i];
    const after = replayPosition(h.operations.slice(0, i + 1));
    events.push({ date: op.date, quantity: after.quantity, cost: after.cost });
    if (op.cash === "outside") {
      const income = op.type === "dividend" || op.type === "yield_payment";
      flows.push({ date: op.date, contributed: income ? 0 : -op.outsideAmountBase, external: -op.outsideAmountBase });
    } else if (op.cash === "none") {
      let amount = 0;
      if (op.type === "buy" || op.type === "deposit" || op.type === "adjustment") amount = after.cost - before.cost;
      else if (op.type === "sell" || op.type === "withdrawal") amount = -(after.realizedGain - before.realizedGain + (before.cost - after.cost));
      if (Math.abs(amount) > EPS) flows.push({ date: op.date, contributed: amount * rate, external: amount * rate });
    }
    before = after;
  }
  return { flows, events };
}

export interface PortfolioTimeline {
  /** Entities with a brokerage account or a holding. */
  entityIds: string[];
  /** First month with anything in the entity's portfolio, or null. */
  firstPeriod(entityId: string): number | null;
  state(entityId: string, period: number): MonthState;
  /** Values the month's positions: at the holdings' current prices ("price") or at cost ("cost", the estimate for past months). */
  value(state: MonthState, mode: "price" | "cost"): HoldingsValue;
}

export function buildTimeline(input: TimelineInput): PortfolioTimeline {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const flowsByEntity = new Map<string, Flow[]>();
  const addFlow = (entityId: string, f: Flow) => {
    const list = flowsByEntity.get(entityId) ?? [];
    list.push(f);
    flowsByEntity.set(entityId, list);
  };
  const firstDate = new Map<string, Date>();
  const touch = (entityId: string, date: Date) => {
    const d = firstDate.get(entityId);
    if (!d || date < d) firstDate.set(entityId, date);
  };

  for (const a of input.accounts) {
    if (!flowsByEntity.has(a.entityId)) flowsByEntity.set(a.entityId, []);
    if (a.initialBalance) {
      const base = a.initialBalance * input.rateFor(a.currency);
      addFlow(a.entityId, { date: a.openedAt, contributed: base, external: base });
      touch(a.entityId, a.openedAt);
    }
  }
  const entriesByAccount = new Map<string, TimelineEntry[]>();
  for (const e of input.entries) {
    const account = accountById.get(e.accountId);
    if (!account) continue;
    const list = entriesByAccount.get(e.accountId) ?? [];
    list.push(e);
    entriesByAccount.set(e.accountId, list);
    touch(account.entityId, e.date);
    if (e.isTransfer) addFlow(account.entityId, { date: e.date, contributed: e.amountBase, external: e.amountBase });
  }
  const eventsByHolding = new Map<string, PositionEvent[]>();
  for (const h of input.holdings) {
    if (!flowsByEntity.has(h.entityId)) flowsByEntity.set(h.entityId, []);
    const { flows, events } = holdingFlows(h, input.rateFor(h.currency));
    for (const f of flows) addFlow(h.entityId, f);
    eventsByHolding.set(h.id, events);
    if (events[0]) touch(h.entityId, events[0].date);
  }

  const state = (entityId: string, period: number): MonthState => {
    const start = monthStart(period);
    const end = monthEnd(period);
    let cash = 0;
    for (const a of input.accounts) {
      if (a.entityId !== entityId) continue;
      let balance = a.openedAt < end ? a.initialBalance : 0;
      for (const e of entriesByAccount.get(a.id) ?? []) if (e.date < end) balance += e.amount;
      cash += balance * input.rateFor(a.currency);
    }
    let contributed = 0;
    let initialPositions = 0;
    let netFlow = 0;
    for (const f of flowsByEntity.get(entityId) ?? []) {
      if (f.date >= end) continue;
      contributed += f.contributed;
      if (f.initial) initialPositions += f.contributed;
      if (f.date >= start) netFlow += f.external;
    }
    const positions: HeldPosition[] = [];
    let costBasis = 0;
    for (const h of input.holdings) {
      if (h.entityId !== entityId) continue;
      let last: PositionEvent | null = null;
      for (const ev of eventsByHolding.get(h.id) ?? []) if (ev.date < end) last = ev;
      if (!last || (last.quantity <= EPS && last.cost <= EPS)) continue;
      positions.push({ holding: h, quantity: last.quantity, cost: last.cost });
      costBasis += last.cost * input.rateFor(h.currency);
    }
    return { entityId, period, cash, costBasis, contributed, initialPositions, netFlow, positions };
  };

  const value = (s: MonthState, mode: "price" | "cost"): HoldingsValue => {
    const byClass = Object.fromEntries(ALLOCATION_CLASSES.map((c) => [c, 0])) as Record<AllocationClass, number>;
    let total = 0;
    for (const p of s.positions) {
      const native = mode === "cost" ? p.cost : marketValue({ assetClass: p.holding.assetClass, currentQuantity: p.quantity, currentPrice: p.holding.currentPrice, totalInvested: p.cost });
      const base = native * input.rateFor(p.holding.currency);
      total += base;
      byClass[p.holding.allocationClass] += base;
    }
    byClass.cash += s.cash;
    return { marketValue: total, byClass };
  };

  return {
    entityIds: [...flowsByEntity.keys()],
    firstPeriod: (entityId) => {
      const d = firstDate.get(entityId);
      return d ? periodOf(d) : null;
    },
    state,
    value,
  };
}
