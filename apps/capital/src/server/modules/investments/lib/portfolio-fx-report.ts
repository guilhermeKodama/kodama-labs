import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { previousBusinessDayClose, type RateClose } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { nextIsActive, replayPosition } from "./holding-position";
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
  rate: number;
  rateDay: string;
  usd: number;
}

interface RepairPlan {
  issues: string[];
  legs: PlannedLeg[];
  detaches: { opId: string; cashId: string; accountId: string }[];
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
  holdings: Map<string, { isActive: boolean; updatedAt: Date; currentQuantity: number; totalInvested: number }>;
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
      transferGroupId: string | null;
      accountCurrency: string;
      accountName: string;
      initialBalance: Prisma.Decimal;
    }[]
  >`
    SELECT e.id, e."accountId", e.amount, e."amountBase", e.currency, e."exchangeRate", e.date, e."createdAt",
           e.description, e."transferGroupId", a.currency AS "accountCurrency", a.name AS "accountName", a."initialBalance"
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
    select: { id: true, type: true, quantity: true, pricePerUnit: true, totalAmount: true, cashEntryId: true, holding: { select: { accountId: true } }, cashEntry: { select: { deletedAt: true } } },
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
      const pattern = near(broker.exchangeRate, 1, 1e-8) && near(other.exchangeRate, 1, 1e-8) && near(Math.abs(broker.amount), Math.abs(other.amount)) && broker.accountCurrency !== other.accountCurrency && broker.currency !== broker.accountCurrency;
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
        issues.push(`unexpected rate-1 cross-currency broker leg ${broker.id} ${broker.accountName} ${day} ${broker.amount}`);
        continue;
      }
      const close = previousBusinessDayClose(closes, day);
      if (!close) {
        issues.push(`no PTAX close before ${day} (${broker.id})`);
        continue;
      }
      const brl = -other.amount;
      legs.push({ entryId: broker.id, accountId: broker.accountId, accountName: broker.accountName, signature, day, brl, rate: close.brlPerUnit, rateDay: close.day, usd: round(brl / close.brlPerUnit, 4) });
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
  const deltaOperationIds = await deltaIds(db);
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
  return { issues, legs, detaches, deltaOperationIds, initials };
}

async function sellIsLive(db: DbClient, accountId: string): Promise<boolean> {
  const ops = await db.investmentOperation.findMany({
    where: { type: "sell", holding: { accountId, ticker: "BTC" }, cashEntry: { deletedAt: null } },
    select: { quantity: true, date: true, cashEntry: { select: { amount: true } } },
  });
  return ops.some((op) => op.quantity != null && near(op.quantity, SELL_QTY, 1e-6) && dayOf(op.date) === SELL_DAY && op.cashEntry != null && toNumber(op.cashEntry.amount) >= SELL_CASH - MONEY);
}

async function deltaIds(db: DbClient): Promise<string[]> {
  const ops = await db.investmentOperation.findMany({ where: { type: "adjustment", adjustmentMode: null }, select: { id: true, quantity: true, pricePerUnit: true } });
  const legacy = new Set<string>();
  const table = await db.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'legacy' AND table_name = 'investment_transactions') AS exists`;
  if (table[0]?.exists && ops.length) {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM legacy.investment_transactions WHERE id IN (${Prisma.join(ops.map((op) => op.id))})`;
    for (const row of rows) legacy.add(row.id);
  }
  return ops.filter((op) => (op.quantity != null && op.quantity < 0) || (op.quantity != null && op.pricePerUnit != null && legacy.has(op.id))).map((op) => op.id);
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

function flowLines(accountId: string, rows: Row[], legs: PlannedLeg[]): string[] {
  const planned = new Map(legs.filter((leg) => leg.accountId === accountId).map((leg) => [leg.entryId, leg]));
  const ordered = rows.filter((row) => row.accountId === accountId).sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return ordered.map((row) => {
    const leg = planned.get(row.id);
    const amount = leg?.usd ?? row.amount;
    const base = `${dayOf(row.date)}\t${fmt(amount, 4)}\tUSD\t${row.description}`;
    return leg ? `${base}\tbrl\t${fmt(leg.brl, 4)}\tptax_day\t${leg.rateDay}\tptax\t${leg.rate}` : base;
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
  const holdings = await db.$queryRaw<{ id: string; currentQuantity: number; totalInvested: number; isActive: boolean; updatedAt: Date }[]>`
    SELECT id, "currentQuantity", "totalInvested", "isActive", "updatedAt" FROM portfolio_fx_repair_holding
  `;
  const cashOf = await db.$queryRaw<{ opId: string; cashId: string }[]>`
    SELECT id AS "opId", "cashEntryId" AS "cashId" FROM investment_operations WHERE "cashEntryId" IN (SELECT id FROM portfolio_fx_repair_entry)
  `;
  return {
    entries: new Map(entries.map((row) => [row.id, { amount: toNumber(row.amount), amountBase: toNumber(row.amountBase), exchangeRate: toNumber(row.exchangeRate), currency: row.currency, deletedAt: row.deletedAt, accountId: row.accountId, date: row.date, createdAt: row.createdAt, description: row.description, transferGroupId: row.transferGroupId }])),
    initials: new Map(initials.map((row) => [row.id, toNumber(row.initialBalance)])),
    modes: new Map(modes.map((row) => [row.id, row.adjustmentMode === "delta" || row.adjustmentMode === "absolute" ? row.adjustmentMode : null])),
    holdings: new Map(holdings.map((row) => [row.id, row])),
    cashOf: new Map(cashOf.map((row) => [row.opId, row.cashId])),
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

export async function portfolioFxReport(db: DbClient, mode: "precheck" | "verify", opts: { userId?: string } = {}): Promise<PortfolioFxReport> {
  const issues: string[] = [];
  const closes = await loadCloses(db);
  const plan = await planRepair(db, closes);
  issues.push(...plan.issues);
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
    sections.push(reconciliation({ source, rows, plan, before: beforeRows, after: afterRows, closes, issues, backup, mode }));
  }
  if (mode === "verify") issues.push(...(await storedChecks(db, opts.userId)));
  const text = [`portfolio fx repair ${mode}`, "Opening cash and opening lots use the previous business day's PTAX on the account openedAt. Live cash and holdings use today's rate.", ...sections, ...issues.map((issue) => `issue\t${issue}`)].join("\n") + "\n";
  return { ok: issues.length === 0, issues, text, before, after };
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
    legs.push({ entryId: row.id, accountId: row.accountId, accountName: row.accountName, signature, day, brl: previous.amount, rate: close.brlPerUnit, rateDay: close.day, usd: row.amount });
  }
  return legs;
}

function reconciliation(input: { source: PortfolioTimelineSource; rows: Row[]; plan: RepairPlan; before: AccountFigures[]; after: AccountFigures[]; closes: RateClose[]; issues: string[]; backup: Backup | null; mode: "precheck" | "verify" }): string {
  const { rows, plan, before, after, closes, issues, backup } = input;
  const lines: string[] = [];
  const legs = correctedLegs(rows, plan, backup, closes);
  const avenue = legs.find((leg) => leg.signature === "avenue_out" || leg.signature === "avenue_in");
  const accountId = avenue?.accountId;
  const detached = new Set(plan.detaches.map((row) => row.cashId));
  if (backup) for (const [id, previous] of backup.entries) if (!previous.deletedAt && !rows.some((row) => row.id === id)) detached.add(id);
  if (accountId) {
    const left = before.find((row) => row.accountId === accountId);
    const right = after.find((row) => row.accountId === accountId);
    const projected = rows.filter((row) => row.accountId === accountId && !detached.has(row.id)).map((row) => {
      const leg = legs.find((item) => item.entryId === row.id);
      return leg ? { ...row, amount: leg.usd, amountBase: leg.brl } : row;
    });
    const flows = flowLines(accountId, projected, legs);
    const sum = projected.reduce((total, row) => total + row.amount, 0);
    const legacy = left?.cashNative ?? 0;
    const opening = right?.openingNative ?? 0;
    const beforeLift = round(legacy - sum, 4);
    const lift = round(opening - beforeLift, 4);
    const identity = near(beforeLift + sum, legacy, 0.001);
    const minPrefix = prefixMin(projected);
    const deficit = -(beforeLift + minPrefix);
    const required = round(beforeLift + (deficit > NATIVE ? deficit : 0), 4);
    if (!identity) issues.push(`Avenue opening + flows ${beforeLift + sum} != legacy ending ${legacy}`);
    if (!near(opening, required, 0.001)) issues.push(`Avenue opening ${opening} != corrected opening ${required}`);
    for (const leg of legs.filter((item) => item.accountId === accountId)) {
      const close = previousBusinessDayClose(closes, leg.day);
      if (!close || !near(leg.usd, round(leg.brl / close.brlPerUnit, 4), NATIVE) || !near(leg.rate, close.brlPerUnit, 1e-8)) issues.push(`Avenue leg ${leg.day} is not BRL / PTAX ${close?.day ?? "?"}`);
    }
    lines.push("avenue_reconciliation_usd");
    lines.push(`legacy_ending\t${fmt(legacy, 4)}`);
    lines.push(`opening_before_lift\t${fmt(beforeLift, 4)}`);
    lines.push(`lift\t${fmt(lift, 4)}`);
    lines.push(`opening_written\t${fmt(opening, 4)}`);
    lines.push("flows");
    lines.push(...flows);
    lines.push(`sum_flows\t${fmt(sum, 4)}`);
    lines.push(`opening_before_lift_plus_flows\t${fmt(round(beforeLift + sum, 4), 4)}`);
    lines.push(`match\t${identity ? "yes" : "no"}`);
    if (right) lines.push(`opening_lot_brl\t${fmt(right.initialPositions - right.openingBrl, 2)}\topening_brl\t${fmt(right.openingBrl, 2)}\tcontributed\t${fmt(right.contributed, 2)}`);
  } else lines.push("avenue_reconciliation_usd\tnone");
  const cryptoAccounts = new Set([...legs.filter((leg) => leg.signature === "crypto_deposit").map((leg) => leg.accountId), ...plan.detaches.map((row) => row.accountId)]);
  if (backup) for (const cashId of backup.cashOf.values()) {
    const previous = backup.entries.get(cashId);
    if (previous) cryptoAccounts.add(previous.accountId);
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

async function storedChecks(db: DbClient, userId?: string): Promise<string[]> {
  const issues: string[] = [];
  const vuaa = await db.investmentHolding.findMany({ where: { ticker: "VUAA", ...(userId ? { account: { userId } } : {}) }, select: { currentQuantity: true, averageCost: true, isActive: true, account: { select: { name: true } } } });
  for (const holding of vuaa) {
    if (!near(holding.currentQuantity, 17.2791, 0.0001) || !near(holding.averageCost, 144.67, 0.01) || !holding.isActive) {
      issues.push(`VUAA on ${holding.account.name} is ${holding.currentQuantity} @ ${holding.averageCost} active=${holding.isActive}`);
    }
  }
  return issues;
}
