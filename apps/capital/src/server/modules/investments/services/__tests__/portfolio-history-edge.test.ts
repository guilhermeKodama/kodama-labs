import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import {
  backfillSnapshots,
  currentPeriod,
  isEstimate,
  loadPortfolioTimelineSource,
  portfolioHistory,
  runPortfolioSnapshots,
  snapshotUser,
} from "../portfolio-history";
import { createHolding, recordOperation } from "../portfolio";
import type { MonthState } from "../../lib/portfolio-timeline";

const USER = "test-user-inv-histedge-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const OCT_6 = new Date("2026-10-06T12:00:00Z");
const NOV_1 = new Date("2026-11-01T12:00:00Z");
const NOV_15 = new Date("2026-11-15T12:00:00Z");

const deposit = (amount: number, date: string) => createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount, date }, prisma);
const snapshots = () => prisma.portfolioSnapshot.findMany({ where: { userId: USER }, orderBy: { period: "asc" } });

/** `prisma`, except that the cron's user query sees the given users instead of everyone in the dev database. */
function dbSeeing(userIds: string[], opts: { failWith?: Record<string, unknown> } = {}) {
  const bound = <T extends object>(target: T, intercept: (prop: string | symbol) => unknown | undefined): T =>
    new Proxy(target, {
      get(t, prop) {
        const replaced = intercept(prop);
        if (replaced !== undefined) return replaced;
        const value = Reflect.get(t, prop);
        return typeof value === "function" ? value.bind(t) : value;
      },
    });
  return bound(prisma, (prop) => {
    if (prop === "account") {
      return bound(prisma.account, (p) => (p === "findMany" ? async (args: { distinct?: unknown }) => (args?.distinct ? userIds.map((userId) => ({ userId })) : prisma.account.findMany(args as never)) : undefined));
    }
    if (prop === "user" && opts.failWith) {
      return bound(prisma.user, (p) =>
        p === "findUnique"
          ? (args: { where: { id: string } }) => {
              if (args.where.id in opts.failWith!) throw opts.failWith![args.where.id];
              return prisma.user.findUnique(args as never);
            }
          : undefined,
      );
    }
    return undefined;
  });
}

describe("which entities get a snapshot", () => {
  it("leaves an entity with no activity at all out, in the cron and in the backfill", async () => {
    // The fixture's broker has no entries, balance or holdings.
    expect(await snapshotUser(USER, prisma, { now: OCT_6 })).toMatchObject({ live: 0, closed: 0 });
    const [backfilled] = await backfillSnapshots(prisma, { userId: USER, now: OCT_6 });
    expect(backfilled).toMatchObject({ created: 0, updated: 0, kept: 0 });
    expect(await snapshots()).toEqual([]);
  });

  it("skips an entity whose first activity is after the current month", async () => {
    await deposit(1000, "2026-12-01");
    expect(await snapshotUser(USER, prisma, { now: OCT_6 })).toMatchObject({ live: 0, closed: 0 });
  });

  it("stores only the live month for an entity that started this month", async () => {
    await deposit(1000, "2026-10-02");
    expect(await snapshotUser(USER, prisma, { now: OCT_6 })).toMatchObject({ live: 1, closed: 0 });
    expect((await snapshots()).map((s) => s.period)).toEqual([202610]);
  });
});

describe("closing the previous month", () => {
  it("values it at today's prices right after the turn of the month, when the cron missed it", async () => {
    await deposit(10000, "2026-07-10");
    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 200, pricePerUnit: 30, totalAmount: 6000, date: "2026-07-15" }, prisma);

    // 1 Nov 12:00: twelve hours after October ended, nothing stored for it yet.
    expect(await snapshotUser(USER, prisma, { now: NOV_1 })).toMatchObject({ live: 1, closed: 1 });
    const oct = (await snapshots()).find((s) => s.period === 202610)!;
    expect(oct).toMatchObject({ estimated: false });
    expect(toNumber(oct.marketValueBase)).toBe(8000);
    expect(toNumber(oct.costBasisBase)).toBe(6000);
    expect(oct.asOf.toISOString()).toBe("2026-10-31T23:59:59.999Z");
  });

  it("values it at cost, flagged as an estimate, when the cron missed it by more than three days", async () => {
    await deposit(10000, "2026-07-10");
    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 200, pricePerUnit: 30, totalAmount: 6000, date: "2026-07-15" }, prisma);
    expect(await snapshotUser(USER, prisma, { now: NOV_15 })).toMatchObject({ live: 1, closed: 1 });
    const oct = (await snapshots()).find((s) => s.period === 202610)!;
    expect(oct.estimated).toBe(true);
    expect(toNumber(oct.marketValueBase)).toBe(6000);
  });

  it("closes a month from the real snapshot stored for it, keeping its market value and re-reading the cash from the ledger", async () => {
    await deposit(5000, "2026-07-10");
    // A mid-October live snapshot with a market value and no breakdown by class (an older row).
    await prisma.portfolioSnapshot.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        period: 202610,
        asOf: new Date("2026-10-15T12:00:00Z"),
        marketValueBase: 777,
        cashBase: 1000,
        costBasisBase: 0,
        contributedBase: 5000,
        netFlowBase: 0,
        byClass: Prisma.JsonNull,
        estimated: false,
      },
    });
    expect(await snapshotUser(USER, prisma, { now: NOV_15 })).toMatchObject({ closed: 1 });
    const oct = (await snapshots()).find((s) => s.period === 202610)!;
    expect(oct.asOf.toISOString()).toBe("2026-10-31T23:59:59.999Z");
    expect(oct.estimated).toBe(false);
    expect(toNumber(oct.marketValueBase)).toBe(777);
    // The ledger says 5000 in cash, the old snapshot 1000: the class cash follows the ledger.
    expect(toNumber(oct.cashBase)).toBe(5000);
    expect(oct.byClass).toMatchObject({ cash: 4000, br_stocks: 0, fii: 0 });
  });

  it("uses the clock when none is given: the live month is today's", async () => {
    await deposit(1000, "2026-07-10");
    const result = await snapshotUser(USER, prisma);
    expect(result.live).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER }, select: { timezone: true } });
    expect((await snapshots()).some((s) => s.period === currentPeriod(user.timezone) && !s.estimated)).toBe(true);
  });
});

describe("runPortfolioSnapshots", () => {
  it("snapshots every user with a portfolio and reports the figures", async () => {
    await deposit(1000, "2026-07-10");
    const result = await runPortfolioSnapshots(dbSeeing([USER]), { now: OCT_6 });
    expect(result).toEqual({ users: 1, live: 1, closed: 1, errors: [] });
    expect((await snapshots()).map((s) => s.period)).toEqual([202609, 202610]);
  });

  it("goes on after a user that fails, reporting the Error message or the text of whatever else was thrown", async () => {
    await deposit(1000, "2026-07-10");
    const db = dbSeeing([USER, "test-user-inv-histedge-ghost", "test-user-inv-histedge-weird"], { failWith: { "test-user-inv-histedge-weird": "plain string failure" } });
    const result = await runPortfolioSnapshots(db, { now: OCT_6 });
    expect(result).toMatchObject({ users: 3, live: 1, closed: 1 });
    expect(result.errors).toHaveLength(2);
    expect(result.errors.find((e) => e.userId === "test-user-inv-histedge-weird")).toEqual({ userId: "test-user-inv-histedge-weird", error: "plain string failure" });
    const ghost = result.errors.find((e) => e.userId === "test-user-inv-histedge-ghost")!;
    expect(ghost.error).toEqual(expect.any(String));
    expect(ghost.error.length).toBeGreaterThan(0);
  });

  it("runs with no users at all", async () => {
    expect(await runPortfolioSnapshots(dbSeeing([]), { now: OCT_6 })).toEqual({ users: 0, live: 0, closed: 0, errors: [] });
  });
});

describe("backfillSnapshots", () => {
  it("uses the clock when none is given, writing the past months and the live one", async () => {
    await deposit(1000, "2026-07-10");
    const [result] = await backfillSnapshots(prisma, { userId: USER });
    expect(result.created).toBeGreaterThanOrEqual(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER }, select: { timezone: true } });
    const periods = (await snapshots()).map((s) => s.period);
    expect(periods).toContain(202607);
    expect(periods).toContain(currentPeriod(user.timezone));
  });
});

describe("portfolioHistory windows", () => {
  it("covers twelve months by default, ending at the current one", async () => {
    await deposit(1000, "2026-07-10");
    const history = await portfolioHistory(USER, prisma, { now: OCT_6 });
    expect(history.months).toHaveLength(12);
    expect(history).toMatchObject({ from: "2025-11", to: "2026-10", baseCurrency: "BRL" });
    expect(history.months.at(-1)).toMatchObject({ period: "2026-10", live: true, netWorth: 1000 });
    expect(history.months[0]).toMatchObject({ period: "2025-11", netWorth: 0, live: false });
  });

  it("returns an empty list of months, ending where it started, for a window of zero months", async () => {
    await deposit(1000, "2026-07-10");
    const history = await portfolioHistory(USER, prisma, { months: 0, now: OCT_6 });
    expect(history).toMatchObject({ months: [], from: "2026-10", to: "2026-10" });
  });

  it("is all zeros for a scope that matches no entity, without reading snapshots", async () => {
    await deposit(1000, "2026-07-10");
    const history = await portfolioHistory(USER, prisma, { months: 3, now: OCT_6, entityIds: ["no-such-entity"] });
    expect(history.months.map((m) => [m.netWorth, m.contributed, m.estimated])).toEqual([
      [0, 0, false],
      [0, 0, false],
      [0, 0, false],
    ]);
  });
});

describe("isEstimate", () => {
  const state = (positions: { assetClass: string; currentPrice: number | null }[]) =>
    ({ positions: positions.map((p) => ({ holding: p })) }) as unknown as MonthState;

  it("is a guess when some position has, or needs, a market price", () => {
    expect(isEstimate(state([]))).toBe(false);
    expect(isEstimate(state([{ assetClass: "fixed_income", currentPrice: null }]))).toBe(false);
    expect(isEstimate(state([{ assetClass: "savings", currentPrice: null }]))).toBe(false);
    expect(isEstimate(state([{ assetClass: "fixed_income", currentPrice: 10 }]))).toBe(true);
    expect(isEstimate(state([{ assetClass: "stocks", currentPrice: null }]))).toBe(true);
  });
});

describe("loadPortfolioTimelineSource", () => {
  it("reads where each operation's cash went: the broker, another account, or nowhere once its leg is in the trash", async () => {
    await deposit(10000, "2026-07-10");
    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    const buy = await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-07-15" }, prisma);
    const bankDividend = await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "dividend", totalAmount: 25, date: "2026-08-15", creditToAccountId: f.pfChecking }, prisma);
    const trashed = await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "dividend", totalAmount: 40, date: "2026-09-15" }, prisma);
    await prisma.ledgerEntry.update({ where: { id: trashed.cashEntryId! }, data: { deletedAt: new Date() } });

    const source = await loadPortfolioTimelineSource(USER, prisma);
    const ops = new Map(source.input.holdings[0].operations.map((op) => [op.id, op]));
    expect(ops.get(buy.operation.id)).toMatchObject({ cash: "broker", outsideAmountBase: 0 });
    expect(ops.get(bankDividend.operation.id)).toMatchObject({ cash: "outside", outsideAmountBase: 25 });
    expect(ops.get(trashed.operation.id)).toMatchObject({ cash: "none", outsideAmountBase: 0 });
    expect(source.accountNames.get(f.broker)).toBe("XP");
    expect(source.holdingAccountIds.get(petr.id)).toBe(f.broker);
  });

  it("opens a broker account at its first entry when that is before the account was created", async () => {
    // An entry backdated before the account row existed: the account counts from the entry.
    await deposit(1000, "2020-01-15");
    const source = await loadPortfolioTimelineSource(USER, prisma);
    const account = source.input.accounts.find((a) => a.id === f.broker)!;
    expect(account.openedAt.toISOString().slice(0, 10)).toBe("2020-01-15");
    expect(source.accountCreatedAt.get(f.broker)!.getTime()).toBeGreaterThan(account.openedAt.getTime());
  });
});
