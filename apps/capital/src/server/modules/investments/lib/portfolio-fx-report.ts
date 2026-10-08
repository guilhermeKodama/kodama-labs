import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { previousBusinessDayClose, type RateClose } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { nextIsActive, replayPosition } from "./holding-position";
import { marketValue } from "./holding-value";
import { buildTimeline, monthEnd, type TimelineEntry, type TimelineHolding, type TimelineInput } from "./portfolio-timeline";
import { currentPeriod, loadPortfolioTimelineSource, type PortfolioTimelineSource } from "../services/portfolio-history";

/**
 * Before/after of the portfolio FX repair. Both columns come from
 * buildTimeline, the same math as Patrimônio, Total aportado and Resultado.
 * Precheck simulates the migration. Verify reads the backup tables it wrote.
 *
 * Opening cash and opening lots use rateOn(openedAt), the previous business
 * day's close. The BTC lot is not priced on its own.
 */

const AVENUE_OUT = -168800.12;
const AVENUE_IN = 2575;
const CRYPTO_DEPOSIT = 10000;
const BTC_QTY = 0.3667;
const BTC_PRICE = 60000;
const BTC_TOTAL = 22002;
const SELL_QTY = 0.0782;
const SELL_DAY = "2026-09-30";
const SELL_CASH = 6757.75;
const MONEY = 0.01;
const NATIVE = 0.0001;
/** A description or metadata quote is used when USD × rate reproduces the BRL amount within this fraction. */
const EXECUTION_TOLERANCE = 0.005;
/** And the quoted rate is within this fraction of that day's PTAX. A rate of 1 reproduces a BRL amount written as USD and is rejected. */
const PTAX_BAND = 0.03;
const RESIDUAL_FLAG = 0.01;

export interface AccountFigures {
  accountId: string;
  name: string;
  currency: string;
  openingNative: number;
  openingBrl: number;
  contributed: number;
  cashNative: number;
  cashBrl: number;
  holdings: number;
  patrimonio: number;
  totalAportado: number;
  resultado: number;
  initialPositions: number;
}

export interface PortfolioFxReport {
  ok: boolean;
  issues: string[];
  warnings: string[];
  text: string;
  before: AccountFigures[];
  after: AccountFigures[];
}

interface Row {
  id: string;
  accountId: string;
  amount: number;
  amountBase: number;
  currency: string;
  exchangeRate: number;
  date: Date;
  createdAt: Date;
  description: string;
  metadata: Prisma.JsonValue | null;
  transferGroupId: string | null;
  accountCurrency: string;
  accountName: string;
  initialBalance: number;
}

interface PlannedLeg {
  entryId: string;
  accountId: string;
  accountName: string;
  signature: "avenue_out" | "avenue_in" | "crypto_deposit";
  day: string;
  brl: number;
  /** Rate written on the leg: the execution quote, or the previous-day PTAX. */
  rate: number;
  /** Previous business day's PTAX, even when `rate` is an execution quote. */
  ptax: number;
  rateDay: string;
  usd: number;
  source: "execution" | "ptax";
}

interface DeltaCandidate {
  id: string;
  ticker: string;
  date: Date;
  quantity: number;
  totalAmount: number;
  notes: string | null;
  userId: string;
}

interface RepairPlan {
  issues: string[];
  warnings: string[];
  legs: PlannedLeg[];
  detaches: { opId: string; cashId: string; accountId: string }[];
  /** Holdings of the opening BTC buys. The replay includes these and no other untouched account. */
  btcHoldingIds: string[];
  deltas: DeltaCandidate[];
  deltaOperationIds: string[];
  initials: Map<string, number>;
}

interface BackupEntry {
  amount: number;
  amountBase: number;
  exchangeRate: number;
  currency: string;
  deletedAt: Date | null;
  accountId: string;
  date: Date;
  createdAt: Date;
  description: string;
  transferGroupId: string | null;
}

interface Backup {
  entries: Map<string, BackupEntry>;
  initials: Map<string, number>;
  modes: Map<string, "delta" | "absolute" | null>;
  holdings: Map<string, { isActive: boolean; updatedAt: Date; currentQuantity: number; averageCost: number; totalInvested: number }>;
  /** Operation id → cash entry id, for legs the migration detached. */
  cashOf: Map<string, string>;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function near(a: number, b: number, tol = MONEY): boolean {
  return Math.abs(a - b) < tol;
}

function fmt(value: number, places: number): string {
  return value.toFixed(places);
}

/**
 * USD amount and BRL-per-USD rate stated on the leg. Accepts `US$33,322.17 @
 * R$5.0657` (and the pt-BR separators, any case) in the description, or the
 * same pair under metadata keys `usd` / `usdAmount` / `amountUsd` and
 * `exchangeRate` / `fxRate` / `rate`. The pair is explicit only when USD × rate
 * reproduces `brlAbs` within 0.5% and the rate is within 3% of `ptax`;
 * otherwise the caller keeps PTAX.
 */
function executionQuote(description: string, metadata: Prisma.JsonValue | null, brlAbs: number, ptax: number): { usd: number; rate: number } | null {
  if (!(brlAbs > 0) || !(ptax > 0)) return null;
  const blob = `${description} ${metadata == null ? "" : typeof metadata === "string" ? metadata : JSON.stringify(metadata)}`;
  const usds = matchedNumbers(blob, /(?:US\$|USD|U\$)\s*([0-9][0-9.,]*)/gi).concat(matchedNumbers(blob, /"(?:usd|usdAmount|amountUsd)"\s*:\s*"?([0-9][0-9.,]*)/gi));
  const rates = matchedNumbers(blob, /@\s*(?:R\$\s*)?([0-9][0-9.,]*)/gi)
    .concat(matchedNumbers(blob, /"(?:exchangeRate|fxRate|rate)"\s*:\s*"?([0-9][0-9.,]*)/gi))
    .filter((rate) => rate > 0.5 && rate < 20);
  let best: { usd: number; rate: number; gap: number } | null = null;
  for (const usd of usds) {
    for (const rate of rates) {
      if (Math.abs(rate / ptax - 1) > PTAX_BAND) continue;
      const gap = Math.abs(usd * rate - brlAbs) / brlAbs;
      if (gap <= EXECUTION_TOLERANCE && (!best || gap < best.gap)) best = { usd, rate, gap };
    }
  }
  return best ? { usd: best.usd, rate: best.rate } : null;
}

function matchedNumbers(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].flatMap((match) => {
    const value = parseLocalizedNumber(match[1] ?? "");
    return value != null && value > 0 ? [value] : [];
  });
}

/** `33,322.17` and `33.322,17` and `5,0657`. A group of exactly three digits after a comma is thousands. */
function parseLocalizedNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const dots = text.split(".").length - 1;
  const commas = text.split(",").length - 1;
  let normalized: string;
  if (dots > 0 && commas > 0) {
    normalized = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (commas > 0) {
    const fraction = text.slice(text.lastIndexOf(",") + 1);
    normalized = fraction.length === 3 ? text.replace(/,/g, "") : text.replace(/,/g, ".");
  } else {
    normalized = text;
  }
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function quotedUsd(brl: number, description: string, metadata: Prisma.JsonValue | null, ptax: number): { usd: number; rate: number; source: "execution" | "ptax" } {
  const quote = executionQuote(description, metadata, Math.abs(brl), ptax);
  if (!quote) return { usd: round(brl / ptax, 4), rate: ptax, source: "ptax" };
  return { usd: round(Math.sign(brl) * quote.usd, 4), rate: quote.rate, source: "execution" };
}

async function loadCloses(db: DbClient): Promise<RateClose[]> {
  const rows = await db.currencyRateDay.findMany({ where: { code: "USD" }, orderBy: { date: "asc" }, select: { date: true, brlPerUnit: true } });
  return rows.map((row) => ({ day: dayOf(row.date), brlPerUnit: toNumber(row.brlPerUnit) }));
}

async function loadRows(db: DbClient): Promise<Row[]> {
  const rows = await db.$queryRaw<
    {
      id: string;
      accountId: string;
      amount: Prisma.Decimal;
      amountBase: Prisma.Decimal;
      currency: string;
      exchangeRate: Prisma.Decimal;
      date: Date;
      createdAt: Date;
      description: string;
      metadata: Prisma.JsonValue | null;
      transferGroupId: string | null;
      accountCurrency: string;
      accountName: string;
      initialBalance: Prisma.Decimal;
    }[]
  >`
    SELECT e.id, e."accountId", e.amount, e."amountBase", e.currency, e."exchangeRate", e.date, e."createdAt",
           e.description, e.metadata, e."transferGroupId", a.currency AS "accountCurrency", a.name AS "accountName", a."initialBalance"
    FROM ledger_entries e
    JOIN accounts a ON a.id = e."accountId" AND a."archivedAt" IS NULL
    WHERE e."deletedAt" IS NULL
      AND (
        a.type = 'brokerage'
        OR e."transferGroupId" IN (
          SELECT le."transferGroupId" FROM ledger_entries le
          JOIN accounts ba ON ba.id = le."accountId" AND ba.type = 'brokerage' AND ba."archivedAt" IS NULL
          WHERE le."deletedAt" IS NULL AND le."transferGroupId" IS NOT NULL
        )
      )
  `;
  return rows.map((row) => ({
    ...row,
    amount: toNumber(row.amount),
    amountBase: toNumber(row.amountBase),
    exchangeRate: toNumber(row.exchangeRate),
    initialBalance: toNumber(row.initialBalance),
  }));
}

function isBtcBuy(op: { type: string; quantity: number | null; pricePerUnit: number | null; totalAmount: number }): boolean {
  return op.type === "buy" && op.quantity != null && op.pricePerUnit != null && near(op.quantity, BTC_QTY, 1e-6) && near(op.pricePerUnit, BTC_PRICE) && near(op.totalAmount, BTC_TOTAL);
}

function prefixMin(entries: { id: string; date: Date; createdAt: Date; amount: number }[]): number {
  const ordered = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let run = 0;
  let min = 0;
  for (const entry of ordered) {
    run = round(run + entry.amount, 4);
    if (run < min) min = run;
  }
  return min;
}

async function planRepair(db: DbClient, closes: RateClose[]): Promise<RepairPlan> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const rows = await loadRows(db);
  const byGroup = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.transferGroupId) continue;
    const list = byGroup.get(row.transferGroupId) ?? [];
    list.push(row);
    byGroup.set(row.transferGroupId, list);
  }
  const buys = await db.investmentOperation.findMany({
    where: { type: "buy", holding: { ticker: "BTC", account: { type: "brokerage", archivedAt: null } } },
    select: { id: true, type: true, quantity: true, pricePerUnit: true, totalAmount: true, cashEntryId: true, holding: { select: { id: true, accountId: true } }, cashEntry: { select: { deletedAt: true } } },
  });
  const btcByAccount = new Map<string, typeof buys>();
  for (const buy of buys.filter(isBtcBuy)) {
    const list = btcByAccount.get(buy.holding.accountId) ?? [];
    list.push(buy);
    btcByAccount.set(buy.holding.accountId, list);
  }
  for (const [accountId, list] of btcByAccount) if (list.length > 1) issues.push(`more than one opening BTC buy on ${accountId}`);

  const legs: PlannedLeg[] = [];
  for (const group of byGroup.values()) {
    if (group.length !== 2) continue;
    for (const broker of group) {
      const other = group.find((row) => row.id !== broker.id)!;
      const usdBrl = broker.accountCurrency === "USD" && other.accountCurrency === "BRL";
      const pattern = near(broker.exchangeRate, 1, 1e-8) && near(other.exchangeRate, 1, 1e-8) && near(Math.abs(broker.amount), Math.abs(other.amount)) && usdBrl && broker.currency !== broker.accountCurrency;
      if (!pattern) continue;
      if (!near(broker.amount + other.amount, 0)) {
        issues.push(`broker and BRL legs do not balance: ${broker.id}`);
        continue;
      }
      const day = dayOf(broker.date);
      const oneBtc = (btcByAccount.get(broker.accountId) ?? []).length === 1;
      const signature: PlannedLeg["signature"] | null =
        day === "2026-08-12" && near(broker.amount, AVENUE_OUT) ? "avenue_out" : day === "2026-09-16" && near(broker.amount, AVENUE_IN) ? "avenue_in" : near(broker.amount, CRYPTO_DEPOSIT) && oneBtc ? "crypto_deposit" : null;
      if (!signature) {
        warnings.push(`unexpected rate-1 cross-currency broker leg ${broker.id} ${broker.accountName} ${day} ${broker.amount}`);
        continue;
      }
      const close = previousBusinessDayClose(closes, day);
      if (!close) {
        issues.push(`no PTAX close before ${day} (${broker.id})`);
        continue;
      }
      const brl = -other.amount;
      const quoted = quotedUsd(brl, broker.description, broker.metadata, close.brlPerUnit);
      legs.push({ entryId: broker.id, accountId: broker.accountId, accountName: broker.accountName, signature, day, brl, rate: quoted.rate, ptax: close.brlPerUnit, rateDay: close.day, usd: quoted.usd, source: quoted.source });
    }
  }
  if (legs.filter((leg) => leg.signature === "avenue_out").length > 1) issues.push("more than one Avenue 2026-08-12 leg");
  if (legs.filter((leg) => leg.signature === "avenue_in").length > 1) issues.push("more than one Avenue 2026-09-16 leg");
  const avenueAccounts = new Set(legs.filter((leg) => leg.signature !== "crypto_deposit").map((leg) => leg.accountId));
  if (avenueAccounts.size > 1) issues.push("Avenue legs are on different accounts");
  const deposits = new Map<string, number>();
  for (const leg of legs) if (leg.signature === "crypto_deposit") deposits.set(leg.accountId, (deposits.get(leg.accountId) ?? 0) + 1);
  for (const [accountId, count] of deposits) {
    if (count > 1) issues.push(`more than one Crypto deposit on ${accountId}`);
    if (avenueAccounts.has(accountId)) issues.push(`Crypto deposit is on the Avenue account ${accountId}`);
  }

  const detaches = [...btcByAccount.values()].flatMap((list) => (list.length === 1 && list[0].cashEntryId && !list[0].cashEntry?.deletedAt ? [{ opId: list[0].id, cashId: list[0].cashEntryId, accountId: list[0].holding.accountId }] : []));
  const btcHoldingIds = [...btcByAccount.values()].flatMap((list) => list.map((buy) => buy.holding.id));
  if (detaches.length) {
    const attached = await db.attachment.count({ where: { ledgerEntryId: { in: detaches.map((row) => row.cashId) } } });
    if (attached > 0) issues.push("the BTC buy cash leg has attachments");
  }
  if (await bothBtcSaleAndAdjustmentLive(db)) issues.push("the 2026-09-30 BTC sell and the 2026-10-02 adjustment are both live");
  const deltas = await deltaCandidates(db);
  const deltaOperationIds = deltas.map((row) => row.id);
  const initials = new Map<string, number>();
  if (!issues.length) {
    const touched = new Set([...legs.map((leg) => leg.accountId), ...detaches.map((row) => row.accountId)]);
    for (const accountId of touched) {
      const accountRows = rows.filter((row) => row.accountId === accountId);
      const legacyEnding = (accountRows[0]?.initialBalance ?? 0) + accountRows.reduce((sum, row) => sum + row.amount, 0);
      const detached = new Set(detaches.filter((row) => row.accountId === accountId).map((row) => row.cashId));
      const usdOf = new Map(legs.filter((leg) => leg.accountId === accountId).map((leg) => [leg.entryId, leg.usd]));
      const after = accountRows.filter((row) => !detached.has(row.id)).map((row) => ({ ...row, amount: usdOf.get(row.id) ?? row.amount }));
      const correctedSum = after.reduce((sum, row) => sum + row.amount, 0);
      const minPrefix = prefixMin(after);
      const crypto = legs.some((leg) => leg.accountId === accountId && leg.signature === "crypto_deposit") || detaches.some((row) => row.accountId === accountId && btcByAccount.has(accountId));
      let opening = crypto ? Math.max(0, -minPrefix) : legacyEnding - correctedSum;
      if (!crypto) {
        const deficit = -(opening + minPrefix);
        if (deficit > NATIVE) opening += deficit;
      }
      if (crypto && (await sellIsLive(db, accountId)) && opening + correctedSum < SELL_CASH - 0.005) opening += SELL_CASH - (opening + correctedSum);
      initials.set(accountId, round(opening, 4));
    }
  }
  return { issues, warnings, legs, detaches, btcHoldingIds, deltas, deltaOperationIds, initials };
}

async function bothBtcSaleAndAdjustmentLive(db: DbClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ holdingId: string }[]>`
    SELECT sell."holdingId" AS "holdingId"
    FROM investment_operations sell
    JOIN investment_operations adj ON adj."holdingId" = sell."holdingId"
    JOIN investment_holdings h ON h.id = sell."holdingId"
    WHERE h.ticker = 'BTC'
      AND sell.type = 'sell'
      AND (sell.date AT TIME ZONE 'UTC')::date = DATE '2026-09-30'
      AND abs(sell.quantity - 0.0782) < 0.000001
      AND adj.type = 'adjustment'
      AND (adj.date AT TIME ZONE 'UTC')::date = DATE '2026-10-02'
      AND adj.quantity IS NOT NULL
      AND abs(adj.quantity - (-0.0782)) < 0.000001
  `;
  return rows.length > 0;
}

async function sellIsLive(db: DbClient, accountId: string): Promise<boolean> {
  const ops = await db.investmentOperation.findMany({
    where: { type: "sell", holding: { accountId, ticker: "BTC" }, cashEntry: { deletedAt: null } },
    select: { quantity: true, date: true, cashEntry: { select: { amount: true } } },
  });
  return ops.some((op) => op.quantity != null && near(op.quantity, SELL_QTY, 1e-6) && dayOf(op.date) === SELL_DAY && op.cashEntry != null && toNumber(op.cashEntry.amount) >= SELL_CASH - MONEY);
}

/**
 * Same predicate as the migration. Only a null mode is eligible; an explicit
 * absolute stays absolute. A negative quantity is a delta only when the row
 * was written before v2 (it is in legacy.investment_transactions). A
 * zero-amount quantity change is a delta unless the notes are the old MCP
 * absolute write, and a positive one also needs pricePerUnit > 0 so a
 * zero-average MCP adjust (price 0, total 0, custom notes) stays absolute.
 */
async function deltaCandidates(db: DbClient): Promise<DeltaCandidate[]> {
  const ops = await db.investmentOperation.findMany({
    where: { type: "adjustment", adjustmentMode: null },
    select: { id: true, quantity: true, pricePerUnit: true, totalAmount: true, notes: true, date: true, holding: { select: { ticker: true, account: { select: { userId: true } } } } },
  });
  const legacy = new Set<string>();
  const table = await db.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'legacy' AND table_name = 'investment_transactions') AS exists`;
  if (table[0]?.exists && ops.length) {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM legacy.investment_transactions WHERE id IN (${Prisma.join(ops.map((op) => op.id))})`;
    for (const row of rows) legacy.add(row.id);
  }
  return ops.flatMap((op) => {
    if (op.quantity == null || op.quantity === 0) return [];
    const manual = /^manual adjustment/i.test(op.notes ?? "");
    const preV2Negative = op.quantity < 0 && legacy.has(op.id);
    const zeroAmount = Math.abs(op.totalAmount) < 1e-7 && !manual && (op.quantity < 0 || (op.pricePerUnit ?? 0) > 0);
    if (!preV2Negative && !zeroAmount) return [];
    return [{ id: op.id, ticker: op.holding.ticker ?? "", date: op.date, quantity: op.quantity, totalAmount: op.totalAmount, notes: op.notes, userId: op.holding.account.userId }];
  });
}

function deltaLine(row: DeltaCandidate): string {
  return ["delta", row.ticker, dayOf(row.date), trimNum(row.quantity, 8), trimNum(row.totalAmount, 4), row.notes ?? ""].join("\t");
}

function trimNum(value: number, places: number): string {
  return value.toFixed(places).replace(/\.?0+$/, "") || "0";
}

function asEntry(row: { accountId: string; date: Date; amount: number; amountBase: number; transferGroupId: string | null }): TimelineEntry {
  return { accountId: row.accountId, date: row.date, amount: row.amount, amountBase: row.amountBase, isTransfer: row.transferGroupId != null };
}

function cloneHoldings(holdings: TimelineHolding[]): TimelineHolding[] {
  return holdings.map((holding) => ({
    ...holding,
    createdAt: new Date(holding.createdAt),
    openedAt: holding.openedAt ? new Date(holding.openedAt) : undefined,
    removedAt: holding.removedAt ? new Date(holding.removedAt) : null,
    operations: holding.operations.map((op) => ({ ...op, date: new Date(op.date) })),
  }));
}

function recomputeOpenedAt(input: TimelineInput, source: PortfolioTimelineSource): TimelineInput {
  const first = new Map<string, Date>();
  for (const entry of input.entries) {
    const known = first.get(entry.accountId);
    if (!known || entry.date < known) first.set(entry.accountId, entry.date);
  }
  const openedAtOf = new Map(input.accounts.map((account) => {
    const created = source.accountCreatedAt.get(account.id) ?? account.openedAt;
    const earliest = first.get(account.id);
    return [account.id, earliest && earliest < created ? earliest : created] as const;
  }));
  return {
    ...input,
    accounts: input.accounts.map((account) => ({ ...account, openedAt: openedAtOf.get(account.id)! })),
    holdings: input.holdings.map((holding) => ({ ...holding, openedAt: openedAtOf.get(source.holdingAccountIds.get(holding.id) ?? "") ?? holding.openedAt })),
  };
}

function withEntries(source: PortfolioTimelineSource, rows: Row[], plan?: RepairPlan): TimelineInput {
  const detached = new Set(plan?.detaches.map((row) => row.cashId) ?? []);
  const usd = new Map(plan?.legs.map((leg) => [leg.entryId, leg]) ?? []);
  const deltas = new Set(plan?.deltaOperationIds ?? []);
  const detachedOps = new Set(plan?.detaches.map((row) => row.opId) ?? []);
  const holdings = cloneHoldings(source.input.holdings).map((holding) => {
    const operations = holding.operations.map((op) => ({
      ...op,
      adjustmentMode: deltas.has(op.id) ? ("delta" as const) : op.adjustmentMode,
      cash: detachedOps.has(op.id) ? ("none" as const) : op.cash,
    }));
    const position = replayPosition(operations);
    const active = nextIsActive({ isActive: holding.removedAt == null, currentQuantity: holding.currentQuantity, totalInvested: holding.totalInvested }, position);
    return { ...holding, operations, removedAt: active ? null : holding.removedAt ?? holding.createdAt };
  });
  const accounts = source.input.accounts.map((account) => ({ ...account, initialBalance: plan?.initials.get(account.id) ?? account.initialBalance }));
  const entries = rows.filter((row) => !detached.has(row.id)).map((row) => {
    const leg = usd.get(row.id);
    return asEntry(leg ? { ...row, amount: leg.usd, amountBase: leg.brl } : row);
  });
  return recomputeOpenedAt({ ...source.input, accounts, entries, holdings }, source);
}

function figuresOf(input: TimelineInput, source: PortfolioTimelineSource, period: number): AccountFigures[] {
  const holdingIds = (accountId: string) => new Set([...source.holdingAccountIds.entries()].filter(([, id]) => id === accountId).map(([holdingId]) => holdingId));
  return input.accounts.map((account) => {
    const ids = holdingIds(account.id);
    const slice: TimelineInput = {
      ...input,
      accounts: [account],
      entries: input.entries.filter((entry) => entry.accountId === account.id),
      holdings: input.holdings.filter((holding) => ids.has(holding.id)),
    };
    const timeline = buildTimeline(slice);
    const state = timeline.state(account.entityId, period);
    const holdings = timeline.value(state, "price").marketValue;
    const end = monthEnd(period);
    let cashNative = account.openedAt < end ? account.initialBalance : 0;
    if (account.openedAt < end) for (const entry of slice.entries) if (entry.date < end) cashNative += entry.amount;
    const openingBrl = account.initialBalance * (input.rateOn?.(account.currency, account.openedAt) ?? input.rateFor(account.currency));
    const patrimonio = state.cash + holdings;
    return {
      accountId: account.id,
      name: source.accountNames.get(account.id) ?? account.id,
      currency: account.currency,
      openingNative: account.initialBalance,
      openingBrl,
      contributed: state.contributed,
      cashNative,
      cashBrl: state.cash,
      holdings,
      patrimonio,
      totalAportado: state.contributed,
      resultado: patrimonio - state.contributed,
      initialPositions: state.initialPositions,
    };
  });
}

function totalsOf(rows: AccountFigures[]) {
  return rows.reduce(
    (sum, row) => ({ patrimonio: sum.patrimonio + row.patrimonio, totalAportado: sum.totalAportado + row.totalAportado, resultado: sum.resultado + row.resultado }),
    { patrimonio: 0, totalAportado: 0, resultado: 0 },
  );
}

const HEADER = ["account", "currency", "opening_native_before", "opening_native_after", "opening_brl_before", "opening_brl_after", "contributed_before", "contributed_after", "cash_native_before", "cash_native_after", "cash_brl_before", "cash_brl_after", "holdings_before", "holdings_after", "patrimonio_before", "patrimonio_after", "total_aportado_before", "total_aportado_after", "resultado_before", "resultado_after"].join("\t");

function table(before: AccountFigures[], after: AccountFigures[]): string {
  const afterById = new Map(after.map((row) => [row.accountId, row]));
  const lines = [HEADER];
  for (const row of before) {
    const next = afterById.get(row.accountId);
    if (!next) continue;
    const native = row.currency === "BRL" ? 2 : 4;
    lines.push(
      [row.name, row.currency, fmt(row.openingNative, native), fmt(next.openingNative, native), fmt(row.openingBrl, 2), fmt(next.openingBrl, 2), fmt(row.contributed, 2), fmt(next.contributed, 2), fmt(row.cashNative, native), fmt(next.cashNative, native), fmt(row.cashBrl, 2), fmt(next.cashBrl, 2), fmt(row.holdings, 2), fmt(next.holdings, 2), fmt(row.patrimonio, 2), fmt(next.patrimonio, 2), fmt(row.totalAportado, 2), fmt(next.totalAportado, 2), fmt(row.resultado, 2), fmt(next.resultado, 2)].join("\t"),
    );
  }
  const left = totalsOf(before);
  const right = totalsOf(after);
  lines.push(["TOTAL", "", "", "", "", "", fmt(left.totalAportado, 2), fmt(right.totalAportado, 2), "", "", "", "", "", "", fmt(left.patrimonio, 2), fmt(right.patrimonio, 2), fmt(left.totalAportado, 2), fmt(right.totalAportado, 2), fmt(left.resultado, 2), fmt(right.resultado, 2)].join("\t"));
  return lines.join("\n");
}

function accountFlows(accountId: string, rows: Row[], backup: Backup | null, replacement: Map<string, number> | null): { id: string; date: Date; createdAt: Date; amount: number; description: string }[] {
  const list = rows.filter((row) => row.accountId === accountId).map((row) => {
    const previous = backup?.entries.get(row.id);
    const restored = previous && !previous.deletedAt ? previous.amount : row.amount;
    return { id: row.id, date: row.date, createdAt: row.createdAt, amount: replacement?.get(row.id) ?? restored, description: row.description };
  });
  if (!backup) return list;
  for (const [id, previous] of backup.entries) {
    if (previous.accountId !== accountId || previous.deletedAt || list.some((row) => row.id === id)) continue;
    list.push({ id, date: previous.date, createdAt: previous.createdAt, amount: replacement?.get(id) ?? previous.amount, description: previous.description });
  }
  return list;
}

function runningFlows(opening: number, rows: { id: string; date: Date; createdAt: Date; amount: number; description: string }[], legs: PlannedLeg[]): string[] {
  const planned = new Map(legs.map((leg) => [leg.entryId, leg]));
  const ordered = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let running = opening;
  return ordered.map((row) => {
    running = round(running + row.amount, 4);
    const leg = planned.get(row.id);
    const base = `${dayOf(row.date)}\t${fmt(row.amount, 4)}\tUSD\t${row.description}\trunning\t${fmt(running, 4)}`;
    return leg ? `${base}\tbrl\t${fmt(leg.brl, 4)}\tptax_day\t${leg.rateDay}\tptax\t${leg.ptax}\tapplied\t${leg.rate}\tsource\t${leg.source}` : base;
  });
}

async function backupTables(db: DbClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('public.portfolio_fx_repair_entry') IS NOT NULL AS exists`;
  return Boolean(rows[0]?.exists);
}

async function loadBackup(db: DbClient): Promise<Backup> {
  const entries = await db.$queryRaw<
    { id: string; amount: Prisma.Decimal; amountBase: Prisma.Decimal; exchangeRate: Prisma.Decimal; currency: string; deletedAt: Date | null; accountId: string; date: Date; createdAt: Date; description: string; transferGroupId: string | null }[]
  >`
    SELECT b.id, b.amount, b."amountBase", b."exchangeRate", b.currency, b."deletedAt",
           e."accountId", e.date, e."createdAt", e.description, e."transferGroupId"
    FROM portfolio_fx_repair_entry b
    JOIN ledger_entries e ON e.id = b.id
  `;
  const initials = await db.$queryRaw<{ id: string; initialBalance: Prisma.Decimal }[]>`SELECT id, "initialBalance" FROM portfolio_fx_repair_account`;
  const modes = await db.$queryRaw<{ id: string; adjustmentMode: string | null }[]>`SELECT id, "adjustmentMode" FROM portfolio_fx_repair_operation`;
  const holdings = await db.$queryRaw<{ id: string; currentQuantity: number; averageCost: number; totalInvested: number; isActive: boolean; updatedAt: Date }[]>`
    SELECT id, "currentQuantity", "averageCost", "totalInvested", "isActive", "updatedAt" FROM portfolio_fx_repair_holding
  `;
  const cashOf = await db.$queryRaw<{ opId: string; cashId: string }[]>`
    SELECT id AS "opId", "cashEntryId" AS "cashId" FROM investment_operations WHERE "cashEntryId" IN (SELECT id FROM portfolio_fx_repair_entry)
  `;
  const removedTable = await db.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('public.portfolio_fx_repair_removed_entry') IS NOT NULL AS exists`;
  const removed = removedTable[0]?.exists
    ? await db.$queryRaw<{ id: string; operationId: string; snapshot: Prisma.JsonValue }[]>`SELECT id, "operationId", snapshot FROM portfolio_fx_repair_removed_entry`
    : [];
  const entryMap = new Map(entries.map((row) => [row.id, { amount: toNumber(row.amount), amountBase: toNumber(row.amountBase), exchangeRate: toNumber(row.exchangeRate), currency: row.currency, deletedAt: row.deletedAt, accountId: row.accountId, date: row.date, createdAt: row.createdAt, description: row.description, transferGroupId: row.transferGroupId }]));
  const cashLinks = new Map(cashOf.map((row) => [row.opId, row.cashId]));
  for (const row of removed) {
    const restored = entryFromSnapshot(row.snapshot);
    if (!restored) continue;
    entryMap.set(row.id, restored);
    cashLinks.set(row.operationId, row.id);
  }
  return {
    entries: entryMap,
    initials: new Map(initials.map((row) => [row.id, toNumber(row.initialBalance)])),
    modes: new Map(modes.map((row) => [row.id, row.adjustmentMode === "delta" || row.adjustmentMode === "absolute" ? row.adjustmentMode : null])),
    holdings: new Map(holdings.map((row) => [row.id, row])),
    cashOf: cashLinks,
  };
}

function entryFromSnapshot(snapshot: Prisma.JsonValue): BackupEntry | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const row = snapshot as Record<string, Prisma.JsonValue>;
  const num = (value: Prisma.JsonValue | undefined) => (typeof value === "number" ? value : Number(value));
  const date = (value: Prisma.JsonValue | undefined) => {
    if (value instanceof Date) return value;
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? new Date(`${text}Z`) : new Date(text);
  };
  if (row.accountId == null || row.amount == null) return null;
  return {
    amount: num(row.amount),
    amountBase: num(row.amountBase),
    exchangeRate: num(row.exchangeRate),
    currency: String(row.currency),
    deletedAt: row.deletedAt ? date(row.deletedAt) : null,
    accountId: String(row.accountId),
    date: date(row.date),
    createdAt: date(row.createdAt),
    description: String(row.description ?? ""),
    transferGroupId: row.transferGroupId ? String(row.transferGroupId) : null,
  };
}

function beforeFromBackup(source: PortfolioTimelineSource, rows: Row[], backup: Backup): TimelineInput {
  const restored: Row[] = rows.map((row) => {
    const previous = backup.entries.get(row.id);
    return previous && !previous.deletedAt ? { ...row, amount: previous.amount, amountBase: previous.amountBase, exchangeRate: previous.exchangeRate, currency: previous.currency } : row;
  });
  for (const [id, previous] of backup.entries) {
    if (previous.deletedAt || restored.some((row) => row.id === id)) continue;
    const account = source.input.accounts.find((item) => item.id === previous.accountId);
    if (!account) continue;
    restored.push({
      id,
      accountId: previous.accountId,
      amount: previous.amount,
      amountBase: previous.amountBase,
      currency: previous.currency,
      exchangeRate: previous.exchangeRate,
      date: previous.date,
      createdAt: previous.createdAt,
      description: previous.description,
      metadata: null,
      transferGroupId: previous.transferGroupId,
      accountCurrency: account.currency,
      accountName: source.accountNames.get(account.id) ?? "",
      initialBalance: backup.initials.get(account.id) ?? account.initialBalance,
    });
  }
  const holdings = cloneHoldings(source.input.holdings).map((holding) => {
    const operations = holding.operations.map((op) => {
      const cashId = backup.cashOf.get(op.id);
      const cash = cashId ? backup.entries.get(cashId) : undefined;
      return {
        ...op,
        adjustmentMode: backup.modes.has(op.id) ? backup.modes.get(op.id) ?? null : op.adjustmentMode,
        cash: cash && !cash.deletedAt ? ("broker" as const) : op.cash,
      };
    });
    const stored = backup.holdings.get(holding.id);
    return {
      ...holding,
      operations,
      removedAt: stored ? (stored.isActive ? null : stored.updatedAt) : holding.removedAt,
      currentQuantity: stored?.currentQuantity ?? holding.currentQuantity,
      totalInvested: stored?.totalInvested ?? holding.totalInvested,
    };
  });
  const accounts = source.input.accounts.map((account) => ({ ...account, initialBalance: backup.initials.get(account.id) ?? account.initialBalance }));
  return recomputeOpenedAt({ ...source.input, accounts, holdings, entries: restored.map(asEntry) }, source);
}

export async function portfolioFxReport(db: DbClient, mode: "precheck" | "verify", opts: { userId?: string; expectTargets?: boolean } = {}): Promise<PortfolioFxReport> {
  const issues: string[] = [];
  const closes = await loadCloses(db);
  const plan = await planRepair(db, closes);
  issues.push(...plan.issues);
  if (opts.expectTargets) issues.push(...(await expectTargetIssues(db, plan, closes, opts.userId)));
  const users = opts.userId ? [{ id: opts.userId }] : await db.user.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const before: AccountFigures[] = [];
  const after: AccountFigures[] = [];
  const sections: string[] = [];
  let backup: Backup | null = null;
  if (mode === "verify") {
    if (!(await backupTables(db))) issues.push("portfolio_fx_repair backup tables are missing; the migration has not run");
    else backup = await loadBackup(db);
  }
  for (const user of users) {
    const source = await loadPortfolioTimelineSource(user.id, db);
    if (!source.input.accounts.length) continue;
    const period = currentPeriod(source.timezone);
    const rows = (await loadRows(db)).filter((row) => source.input.accounts.some((account) => account.id === row.accountId));
    const beforeInput = mode === "verify" && backup ? beforeFromBackup(source, rows, backup) : { ...source.input };
    const afterInput = mode === "precheck" && !plan.issues.length ? withEntries(source, rows, plan) : { ...source.input };
    const beforeRows = figuresOf(beforeInput, source, period);
    const afterRows = figuresOf(afterInput, source, period);
    before.push(...beforeRows);
    after.push(...afterRows);
    sections.push(table(beforeRows, afterRows));
    sections.push(await reconciliation(db, { source, rows, plan, before: beforeRows, after: afterRows, closes, issues, backup, mode }));
    sections.push(decomposition(afterInput, source, afterRows, period));
    sections.push(await holdingLines(db, user.id, mode, plan, backup));
    const deltas = mode === "verify" && backup ? await markedDeltas(db, backup, user.id) : plan.deltas.filter((row) => row.userId === user.id);
    if (deltas.length) sections.push(deltas.map(deltaLine).join("\n"));
  }
  if (mode === "verify") issues.push(...(await storedChecks(db, opts.userId, backup)));
  const text = [`portfolio fx repair ${mode}`, "Opening cash and opening lots use the previous business day's PTAX on the account openedAt. Live cash and holdings use today's rate.", ...sections, ...plan.warnings.map((warning) => `warn\t${warning}`), ...issues.map((issue) => `issue\t${issue}`)].join("\n") + "\n";
  return { ok: issues.length === 0, issues, warnings: plan.warnings, text, before, after };
}

function correctedLegs(rows: Row[], plan: RepairPlan, backup: Backup | null, closes: RateClose[]): PlannedLeg[] {
  if (plan.legs.length) return plan.legs;
  if (!backup) return [];
  const legs: PlannedLeg[] = [];
  for (const row of rows) {
    const previous = backup.entries.get(row.id);
    if (!previous || previous.deletedAt || near(previous.amount, row.amount, NATIVE)) continue;
    const day = dayOf(row.date);
    const close = previousBusinessDayClose(closes, day);
    if (!close) continue;
    const signature: PlannedLeg["signature"] | null = near(previous.amount, AVENUE_OUT) ? "avenue_out" : near(previous.amount, AVENUE_IN) ? "avenue_in" : near(previous.amount, CRYPTO_DEPOSIT) ? "crypto_deposit" : null;
    if (!signature) continue;
    const brl = previous.amount;
    const quote = executionQuote(row.description, row.metadata, Math.abs(brl), close.brlPerUnit);
    const executed = quote != null && near(row.amount, round(Math.sign(brl) * quote.usd, 4), NATIVE) && near(row.exchangeRate, quote.rate, 1e-4);
    legs.push({
      entryId: row.id,
      accountId: row.accountId,
      accountName: row.accountName,
      signature,
      day,
      brl,
      rate: executed && quote ? quote.rate : close.brlPerUnit,
      ptax: close.brlPerUnit,
      rateDay: close.day,
      usd: row.amount,
      source: executed ? "execution" : "ptax",
    });
  }
  return legs;
}

async function reconciliation(db: DbClient, input: { source: PortfolioTimelineSource; rows: Row[]; plan: RepairPlan; before: AccountFigures[]; after: AccountFigures[]; closes: RateClose[]; issues: string[]; backup: Backup | null; mode: "precheck" | "verify" }): Promise<string> {
  const { source, rows, plan, before, after, closes, issues, backup } = input;
  const lines: string[] = [];
  const accountIds = new Set(source.input.accounts.map((account) => account.id));
  const legs = correctedLegs(rows, plan, backup, closes).filter((leg) => accountIds.has(leg.accountId));
  for (const leg of legs) lines.push(["leg_source", leg.signature, leg.accountName, leg.day, leg.source, leg.rate, fmt(leg.usd, 4)].join("\t"));
  const avenue = legs.find((leg) => leg.signature === "avenue_out" || leg.signature === "avenue_in");
  const accountId = avenue?.accountId;
  const detached = new Set(plan.detaches.filter((row) => accountIds.has(row.accountId)).map((row) => row.cashId));
  if (backup) {
    for (const [id, previous] of backup.entries) {
      if (!accountIds.has(previous.accountId) || previous.deletedAt || rows.some((row) => row.id === id)) continue;
      detached.add(id);
    }
  }
  if (accountId) {
    const left = before.find((row) => row.accountId === accountId);
    const right = after.find((row) => row.accountId === accountId);
    const projected = rows.filter((row) => row.accountId === accountId && !detached.has(row.id)).map((row) => {
      const leg = legs.find((item) => item.entryId === row.id);
      return leg ? { ...row, amount: leg.usd, amountBase: leg.brl } : row;
    });
    const beforeFlows = accountFlows(accountId, rows, backup, null);
    const endingBefore = round((left?.openingNative ?? 0) + beforeFlows.reduce((total, row) => total + row.amount, 0), 4);
    const endingAfter = round((right?.openingNative ?? 0) + projected.reduce((total, row) => total + row.amount, 0), 4);
    const correctedSum = projected.reduce((total, row) => total + row.amount, 0);
    const baseInitial = round(endingBefore - correctedSum, 4);
    const minPrefix = prefixMin(projected);
    const deficit = -(baseInitial + minPrefix);
    const lift = round(deficit > NATIVE ? deficit : 0, 4);
    const identity = near(endingAfter, endingBefore + lift, 0.001);
    if (!identity) issues.push(`Avenue ending cash ${endingAfter} != ending before ${endingBefore} + lift ${lift}`);
    for (const leg of legs.filter((item) => item.accountId === accountId)) {
      if (leg.source === "execution") {
        const scale = Math.abs(leg.brl);
        const gap = scale > 0 ? Math.abs(Math.abs(leg.usd) * leg.rate - scale) / scale : 1;
        if (gap > EXECUTION_TOLERANCE) issues.push(`Avenue leg ${leg.day} execution quote does not reproduce the BRL amount`);
      } else {
        const close = previousBusinessDayClose(closes, leg.day);
        if (!close || !near(leg.usd, round(leg.brl / close.brlPerUnit, 4), NATIVE) || !near(leg.rate, close.brlPerUnit, 1e-8)) issues.push(`Avenue leg ${leg.day} is not BRL / PTAX ${close?.day ?? "?"}`);
      }
    }
    lines.push("avenue_reconciliation_usd");
    lines.push(`ending_before\t${fmt(endingBefore, 4)}`);
    lines.push(`lift\t${fmt(lift, 4)}`);
    lines.push(`ending_after\t${fmt(endingAfter, 4)}`);
    lines.push(`ending_before_plus_lift\t${fmt(round(endingBefore + lift, 4), 4)}`);
    lines.push(`opening_written\t${fmt(right?.openingNative ?? 0, 4)}`);
    lines.push("flows");
    lines.push(...runningFlows(right?.openingNative ?? 0, projected, legs));
    lines.push(`sum_flows\t${fmt(correctedSum, 4)}`);
    lines.push(`match\t${identity ? "yes" : "no"}`);
    lines.push(await legacyCashLine(db, accountId, endingBefore, rows, backup, issues));
    if (right) lines.push(`opening_lot_brl\t${fmt(right.initialPositions - right.openingBrl, 2)}\topening_brl\t${fmt(right.openingBrl, 2)}\tcontributed\t${fmt(right.contributed, 2)}`);
  } else lines.push("avenue_reconciliation_usd\tnone");
  const cryptoAccounts = new Set([
    ...legs.filter((leg) => leg.signature === "crypto_deposit").map((leg) => leg.accountId),
    ...plan.detaches.filter((row) => accountIds.has(row.accountId)).map((row) => row.accountId),
  ]);
  if (backup) {
    for (const cashId of backup.cashOf.values()) {
      const previous = backup.entries.get(cashId);
      if (previous && accountIds.has(previous.accountId)) cryptoAccounts.add(previous.accountId);
    }
  }
  for (const accountIdOf of cryptoAccounts) {
    const row = after.find((item) => item.accountId === accountIdOf);
    if (!row) continue;
    const accountRows = rows.filter((item) => item.accountId === accountIdOf && !detached.has(item.id)).map((item) => ({ ...item, amount: legs.find((leg) => leg.entryId === item.id)?.usd ?? item.amount }));
    const opening = row.openingNative;
    const minPrefix = prefixMin(accountRows);
    let required = round(Math.max(0, -minPrefix), 4);
    const ending = required + accountRows.reduce((total, item) => total + item.amount, 0);
    const sell = accountRows.some((item) => dayOf(item.date) === SELL_DAY && item.amount >= SELL_CASH - MONEY);
    if (sell && ending < SELL_CASH - 0.005) required = round(required + (SELL_CASH - ending), 4);
    const min = round(opening + minPrefix, 4);
    if (min < -NATIVE) issues.push(`${row.name} cash goes negative (${min})`);
    if (!near(opening, required, 0.001)) issues.push(`${row.name} opening ${opening} != ${required}`);
    if (sell && row.cashNative < SELL_CASH - MONEY) issues.push(`${row.name} cash ${row.cashNative} is below ${SELL_CASH}`);
    lines.push(`crypto\t${row.name}\topening_after\t${fmt(opening, 4)}\tcash_after\t${fmt(row.cashNative, 4)}\trunning_min\t${fmt(min, 4)}\tsell\t${sell ? "yes" : "no"}\topening_lot_brl\t${fmt(row.initialPositions - row.openingBrl, 2)}`);
  }
  return lines.join("\n");
}

async function storedChecks(db: DbClient, userId: string | undefined, backup: Backup | null): Promise<string[]> {
  const issues: string[] = [];
  const backedIds = backup ? [...backup.holdings.keys()] : [];
  const holdings = await db.investmentHolding.findMany({
    where: {
      ...(userId ? { account: { userId } } : {}),
      OR: [{ operations: { some: { adjustmentMode: "delta" } } }, ...(backedIds.length ? [{ id: { in: backedIds } }] : [])],
    },
    select: {
      id: true,
      ticker: true,
      currentQuantity: true,
      averageCost: true,
      totalInvested: true,
      isActive: true,
      account: { select: { name: true } },
      operations: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, type: true, quantity: true, pricePerUnit: true, totalAmount: true, fees: true, adjustmentMode: true } },
    },
  });
  for (const holding of holdings) {
    const hasDelta = holding.operations.some((op) => op.adjustmentMode === "delta");
    const prior = backup?.holdings.get(holding.id);
    if (!hasDelta && !prior) continue;
    const position = replayPosition(holding.operations);
    const active = nextIsActive(
      { isActive: prior?.isActive ?? holding.isActive, currentQuantity: prior?.currentQuantity ?? holding.currentQuantity, totalInvested: prior?.totalInvested ?? holding.totalInvested },
      position,
    );
    const storedMatches = near(holding.currentQuantity, position.quantity, 1e-6) && near(holding.averageCost, position.averageCost, 1e-6) && near(holding.totalInvested, position.cost, 0.005) && holding.isActive === active;
    if (!storedMatches) {
      issues.push(`${holding.ticker} on ${holding.account.name} stored ${holding.currentQuantity} @ ${holding.averageCost} cost ${holding.totalInvested} active=${holding.isActive} != replay ${position.quantity} @ ${position.averageCost} cost ${position.cost} active=${active}`);
    }
  }
  return issues;
}

async function markedDeltas(db: DbClient, backup: Backup, userId: string): Promise<DeltaCandidate[]> {
  const ids = [...backup.modes.keys()];
  if (!ids.length) return [];
  const ops = await db.investmentOperation.findMany({
    where: { id: { in: ids }, holding: { account: { userId } } },
    select: { id: true, quantity: true, totalAmount: true, notes: true, date: true, holding: { select: { ticker: true, account: { select: { userId: true } } } } },
  });
  return ops.flatMap((op) => (op.quantity == null ? [] : [{ id: op.id, ticker: op.holding.ticker ?? "", date: op.date, quantity: op.quantity, totalAmount: op.totalAmount, notes: op.notes, userId: op.holding.account.userId }]));
}

async function holdingLines(db: DbClient, userId: string, mode: "precheck" | "verify", plan: RepairPlan, backup: Backup | null): Promise<string> {
  const holdings = await db.investmentHolding.findMany({
    where: { account: { userId, type: "brokerage", archivedAt: null } },
    select: {
      id: true,
      ticker: true,
      accountId: true,
      currentQuantity: true,
      averageCost: true,
      totalInvested: true,
      isActive: true,
      operations: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, type: true, quantity: true, pricePerUnit: true, totalAmount: true, fees: true, adjustmentMode: true } },
    },
  });
  const btcHoldings = new Set(plan.btcHoldingIds);
  const lines: string[] = [];
  for (const holding of holdings) {
    const inReplay = holding.operations.length > 0 && (holding.operations.some((op) => plan.deltaOperationIds.includes(op.id) || op.adjustmentMode === "delta") || btcHoldings.has(holding.id) || backup?.holdings.has(holding.id) === true);
    if (!inReplay) continue;
    const prior = mode === "verify" ? backup?.holdings.get(holding.id) : undefined;
    const before = {
      quantity: prior?.currentQuantity ?? holding.currentQuantity,
      average: prior?.averageCost ?? holding.averageCost,
      cost: prior?.totalInvested ?? holding.totalInvested,
      active: prior?.isActive ?? holding.isActive,
    };
    const operations = holding.operations.map((op) => ({ ...op, adjustmentMode: plan.deltaOperationIds.includes(op.id) ? ("delta" as const) : op.adjustmentMode }));
    const position = replayPosition(mode === "verify" ? holding.operations : operations);
    const afterActive = mode === "verify" ? holding.isActive : nextIsActive({ isActive: before.active, currentQuantity: before.quantity, totalInvested: before.cost }, position);
    const after = mode === "verify"
      ? { quantity: holding.currentQuantity, average: holding.averageCost, cost: holding.totalInvested, active: holding.isActive }
      : { quantity: position.quantity, average: position.averageCost, cost: position.cost, active: afterActive };
    const changed = !near(before.quantity, after.quantity, 1e-6) || !near(before.average, after.average, 1e-6) || !near(before.cost, after.cost, 0.005) || before.active !== after.active;
    if (!changed) continue;
    lines.push(["holding", holding.ticker, "qty", trimNum(before.quantity, 8), trimNum(after.quantity, 8), "average", trimNum(before.average, 4), trimNum(after.average, 4), "cost", trimNum(before.cost, 4), trimNum(after.cost, 4), "active", before.active, after.active].join("\t"));
  }
  return lines.join("\n");
}

async function expectTargetIssues(db: DbClient, plan: RepairPlan, closes: RateClose[], userId?: string): Promise<string[]> {
  const issues: string[] = [];
  const scope = userId ? new Set((await db.account.findMany({ where: { userId }, select: { id: true } })).map((row) => row.id)) : null;
  const inScope = (accountId: string) => !scope || scope.has(accountId);
  const avenueOut = await targetLegCount(db, plan, closes, "avenue_out", "2026-08-12", AVENUE_OUT, 5.1285, inScope);
  const avenueIn = await targetLegCount(db, plan, closes, "avenue_in", "2026-09-16", AVENUE_IN, 5.149, inScope);
  const deposit = await repairedDepositCount(db, plan, closes, inScope);
  const buys = await db.investmentOperation.findMany({
    where: { type: "buy", holding: { ticker: "BTC", account: { type: "brokerage", archivedAt: null, ...(userId ? { userId } : {}) } } },
    select: { type: true, quantity: true, pricePerUnit: true, totalAmount: true },
  });
  const btc = buys.filter(isBtcBuy).length;
  const found: [string, number][] = [["Avenue 2026-08-12 leg", avenueOut], ["Avenue 2026-09-16 leg", avenueIn], ["Crypto deposit", deposit], ["BTC buy", btc]];
  for (const [label, count] of found) if (count !== 1) issues.push(`--expect-targets: ${label} found ${count} time(s)`);
  return issues;
}

async function targetLegCount(db: DbClient, plan: RepairPlan, closes: RateClose[], signature: PlannedLeg["signature"], day: string, brokerAmount: number, rate: number, inScope: (accountId: string) => boolean): Promise<number> {
  const planned = new Set(plan.legs.filter((leg) => leg.signature === signature && inScope(leg.accountId)).map((leg) => leg.entryId));
  const rows = await db.$queryRaw<{ id: string; accountId: string; amount: Prisma.Decimal; amountBase: Prisma.Decimal; exchangeRate: Prisma.Decimal; date: Date; description: string; metadata: Prisma.JsonValue | null }[]>`
    SELECT b.id, b."accountId", b.amount, b."amountBase", b."exchangeRate", b.date, b.description, b.metadata
    FROM ledger_entries b
    JOIN accounts a ON a.id = b."accountId" AND a.type = 'brokerage' AND a.currency = 'USD' AND a."archivedAt" IS NULL
    JOIN ledger_entries o ON o."transferGroupId" = b."transferGroupId" AND o.id <> b.id AND o."deletedAt" IS NULL
    JOIN accounts oa ON oa.id = o."accountId" AND oa.currency = 'BRL'
    WHERE b."deletedAt" IS NULL AND b.currency = 'USD' AND b.date::date = ${day}::date
  `;
  for (const row of rows) {
    if (!inScope(row.accountId) || planned.has(row.id)) continue;
    const close = previousBusinessDayClose(closes, day);
    if (!close || !near(close.brlPerUnit, rate, 1e-8)) continue;
    if (repairedLeg(toNumber(row.amount), toNumber(row.amountBase), toNumber(row.exchangeRate), row.description, row.metadata, brokerAmount, close.brlPerUnit)) planned.add(row.id);
  }
  return planned.size;
}

async function repairedDepositCount(db: DbClient, plan: RepairPlan, closes: RateClose[], inScope: (accountId: string) => boolean): Promise<number> {
  const planned = new Set(plan.legs.filter((leg) => leg.signature === "crypto_deposit" && inScope(leg.accountId)).map((leg) => leg.entryId));
  const rows = await db.$queryRaw<{ id: string; accountId: string; amount: Prisma.Decimal; amountBase: Prisma.Decimal; exchangeRate: Prisma.Decimal; date: Date; description: string; metadata: Prisma.JsonValue | null }[]>`
    SELECT b.id, b."accountId", b.amount, b."amountBase", b."exchangeRate", b.date, b.description, b.metadata
    FROM ledger_entries b
    JOIN accounts a ON a.id = b."accountId" AND a.type = 'brokerage' AND a.currency = 'USD' AND a."archivedAt" IS NULL
    WHERE b."deletedAt" IS NULL AND b.currency = 'USD' AND abs(b."amountBase" - 10000) < 0.05
  `;
  for (const row of rows) {
    if (!inScope(row.accountId) || planned.has(row.id)) continue;
    const close = previousBusinessDayClose(closes, dayOf(row.date));
    if (!close) continue;
    const buys = await db.investmentOperation.count({ where: { type: "buy", holding: { accountId: row.accountId, ticker: "BTC" }, quantity: { gte: BTC_QTY - 1e-6, lte: BTC_QTY + 1e-6 }, pricePerUnit: { gte: BTC_PRICE - 0.01, lte: BTC_PRICE + 0.01 }, totalAmount: { gte: BTC_TOTAL - 0.01, lte: BTC_TOTAL + 0.01 } } });
    if (buys !== 1) continue;
    if (repairedLeg(toNumber(row.amount), toNumber(row.amountBase), toNumber(row.exchangeRate), row.description, row.metadata, CRYPTO_DEPOSIT, close.brlPerUnit)) planned.add(row.id);
  }
  return planned.size;
}

/** A repaired target: amountBase is still the BRL amount, and the USD amount is either BRL / PTAX or the execution quote. */
function repairedLeg(amount: number, amountBase: number, exchangeRate: number, description: string, metadata: Prisma.JsonValue | null, brokerAmount: number, ptax: number): boolean {
  if (!near(amountBase, brokerAmount, 0.05)) return false;
  if (near(exchangeRate, ptax, 1e-4) && near(amount, round(brokerAmount / ptax, 4), NATIVE)) return true;
  const quote = executionQuote(description, metadata, Math.abs(brokerAmount), ptax);
  return quote != null && near(exchangeRate, quote.rate, 1e-4) && near(amount, round(Math.sign(brokerAmount) * quote.usd, 4), NATIVE);
}

/**
 * Resultado = Patrimônio − Total aportado, split so each piece can be checked
 * on its own. Unrealized is the current holding marked against its average
 * cost (native, then today's BRL). Realized is sell/withdrawal gain at today's
 * rate. Income is dividend and yield that stayed in the broker. FX on cash is
 * the opening balance and transfer flows marked from the rate that booked them
 * to today. FX on cost is the same gap for no-cash opening lots and later
 * no-cash buys. Residual is what those pieces do not explain, and it is flagged
 * when it exceeds 1% of Patrimônio.
 */
function decomposition(input: TimelineInput, source: PortfolioTimelineSource, rows: AccountFigures[], period: number): string {
  const lines: string[] = [];
  const holdingIds = (accountId: string) => new Set([...source.holdingAccountIds.entries()].filter(([, id]) => id === accountId).map(([holdingId]) => holdingId));
  for (const row of rows) {
    const account = input.accounts.find((item) => item.id === row.accountId);
    if (!account) continue;
    const ids = holdingIds(account.id);
    const slice: TimelineInput = {
      ...input,
      accounts: [account],
      entries: input.entries.filter((entry) => entry.accountId === account.id),
      holdings: input.holdings.filter((holding) => ids.has(holding.id)),
    };
    lines.push(decompositionBlock(slice, row, period));
  }
  return lines.join("\n");
}

function decompositionBlock(input: TimelineInput, row: AccountFigures, period: number): string {
  const account = input.accounts[0];
  if (!account) return "";
  const nativePlaces = account.currency === "BRL" ? 2 : 4;
  const today = input.rateFor(account.currency);
  const open = input.rateOn?.(account.currency, account.openedAt) ?? today;
  let fxCash = account.initialBalance * (today - open);
  for (const entry of input.entries) if (entry.isTransfer) fxCash += entry.amount * today - entry.amountBase;

  const timeline = buildTimeline(input);
  const state = timeline.state(account.entityId, period);
  let unrealizedNative = 0;
  let unrealizedBrl = 0;
  let costNative = 0;
  let marketNative = 0;
  for (const position of state.positions) {
    const native = marketValue({ assetClass: position.holding.assetClass, currentQuantity: position.quantity, currentPrice: position.holding.currentPrice, totalInvested: position.cost });
    const rate = input.rateFor(position.holding.currency);
    unrealizedBrl += (native - position.cost) * rate;
    if (position.holding.currency === account.currency) {
      unrealizedNative += native - position.cost;
      costNative += position.cost;
      marketNative += native;
    }
  }

  let realizedNative = 0;
  let realizedBrl = 0;
  let income = 0;
  let fxCost = 0;
  for (const holding of input.holdings) {
    const rate = input.rateFor(holding.currency);
    const position = replayPosition(holding.operations);
    realizedBrl += position.realizedGain * rate;
    if (holding.currency === account.currency) realizedNative += position.realizedGain;
    for (const op of holding.operations) {
      if ((op.type === "dividend" || op.type === "yield_payment") && op.cash === "broker") income += op.totalAmount * rate;
    }
    fxCost += costBasisFx(holding, input);
  }

  const unrealized = round(unrealizedBrl, 2);
  const realized = round(realizedBrl, 2);
  const incomeBrl = round(income, 2);
  const fxCashBrl = round(fxCash, 2);
  const fxCostBrl = round(fxCost, 2);
  const resultado = round(row.resultado, 2);
  const residual = round(resultado - unrealized - realized - incomeBrl - fxCashBrl - fxCostBrl, 2);
  const flagged = Math.abs(residual) > Math.abs(round(row.patrimonio, 2)) * RESIDUAL_FLAG;
  return [
    ["resultado_decomposition", row.name, account.currency].join("\t"),
    ["unrealized_native", fmt(unrealizedNative, nativePlaces), "cost_native", fmt(costNative, nativePlaces), "market_native", fmt(marketNative, nativePlaces)].join("\t"),
    `unrealized_brl\t${fmt(unrealized, 2)}`,
    ["realized_native", fmt(realizedNative, nativePlaces)].join("\t"),
    `realized_brl\t${fmt(realized, 2)}`,
    `income_brl\t${fmt(incomeBrl, 2)}`,
    `fx_cash_brl\t${fmt(fxCashBrl, 2)}`,
    `fx_cost_brl\t${fmt(fxCostBrl, 2)}`,
    `residual_brl\t${fmt(residual, 2)}`,
    `patrimonio_brl\t${fmt(round(row.patrimonio, 2), 2)}`,
    `resultado_brl\t${fmt(resultado, 2)}`,
    `residual_flag\t${flagged ? "yes" : "no"}`,
  ].join("\n");
}

/** BRL change from marking no-cash cost (opening lots and later no-cash buys) at today's rate instead of the rate that booked it. */
function costBasisFx(holding: TimelineHolding, input: TimelineInput): number {
  if (holding.removedAt) {
    const position = replayPosition(holding.operations);
    if (position.cost > 1e-9 || position.quantity > 1e-9) return 0;
  }
  const today = input.rateFor(holding.currency);
  const openRate = input.rateOn?.(holding.currency, holding.openedAt ?? holding.createdAt) ?? today;
  if (!holding.operations.length) return holding.totalInvested * (today - openRate);
  let native = 0;
  let booked = 0;
  let before = replayPosition([]);
  for (let i = 0; i < holding.operations.length; i++) {
    const op = holding.operations[i];
    const after = replayPosition(holding.operations.slice(0, i + 1));
    if ((op.type !== "buy" && op.type !== "deposit") || op.cash !== "none") {
      before = after;
      continue;
    }
    const delta = after.cost - before.cost;
    if (Math.abs(delta) > 1e-9) {
      const rate = i === 0 ? openRate : (input.rateOn?.(holding.currency, op.date) ?? today);
      native += delta;
      booked += delta * rate;
    }
    before = after;
  }
  return native * today - booked;
}

async function legacyCashLine(db: DbClient, accountId: string, endingBefore: number, rows: Row[], backup: Backup | null, issues: string[]): Promise<string> {
  const schema = await db.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('legacy.investment_accounts') IS NOT NULL AS exists`;
  if (!schema[0]?.exists) return "legacy_schema\tmissing";
  const accounts = await db.$queryRaw<{ cashBalance: number }[]>`SELECT "cashBalance" FROM legacy.investment_accounts WHERE id = ${accountId}`;
  if (!accounts.length) return "legacy_account\tmissing";
  const cashBalance = accounts[0]?.cashBalance ?? 0;
  const flows = accountFlows(accountId, rows, backup, null);
  const ids = flows.map((row) => row.id);
  const mapped = ids.length
    ? new Set((await db.$queryRaw<{ id: string }[]>`SELECT new_id AS id FROM legacy.id_map WHERE new_model = 'LedgerEntry' AND new_id IN (${Prisma.join(ids)})`).map((row) => row.id))
    : new Set<string>();
  const added = flows.filter((row) => !mapped.has(row.id)).reduce((total, row) => total + row.amount, 0);
  const expected = round(cashBalance + added, 4);
  if (!near(endingBefore, expected, 0.05)) issues.push(`Avenue ending before ${endingBefore} != legacy cashBalance ${cashBalance} + entries since backfill ${added}`);
  return `legacy_cash\t${fmt(cashBalance, 4)}\tadded_since_backfill\t${fmt(added, 4)}\texpected_ending_before\t${fmt(expected, 4)}`;
}
