import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { backfillSnapshots, currentPeriod, portfolioHistory, snapshotUser } from "../portfolio-history";
import { createHolding, portfolioSummary, recordOperation } from "../portfolio";

const USER = "test-user-investments-history-001";
let f: LedgerFixture;
let pjBroker: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  pjBroker = (await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } })).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const deposit = (fromAccountId: string, toAccountId: string, amount: number, date: string) => createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date }, prisma);

/** PF: 10k in on 10/jul, 200 PETR4 at 30 on 15/jul, 2k in on 5/sep. PJ: 5k into its broker on 1/aug. */
async function seed() {
  await deposit(f.pfChecking, f.broker, 10000, "2026-07-10");
  const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
  await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 200, pricePerUnit: 30, totalAmount: 6000, date: "2026-07-15" }, prisma);
  await deposit(f.pjChecking, pjBroker, 5000, "2026-08-01");
  await deposit(f.pfChecking, f.broker, 2000, "2026-09-05");
  return petr;
}

const OCT_6 = new Date("2026-10-06T12:00:00Z");
const NOV_1 = new Date("2026-11-01T12:00:00Z");
const NOV_15 = new Date("2026-11-15T12:00:00Z");

describe("currentPeriod", () => {
  it("uses the user's timezone", () => {
    // 1 Nov 01:00 UTC is still 31 Oct in São Paulo.
    expect(currentPeriod("America/Sao_Paulo", new Date("2026-11-01T01:00:00Z"))).toBe(202610);
    expect(currentPeriod("UTC", new Date("2026-11-01T01:00:00Z"))).toBe(202611);
  });
});

describe("portfolio history and snapshots", () => {
  it("rebuilds past months at cost (estimated), values the live month at today's prices and chains Dietz only over real months", async () => {
    const petr = await seed();

    const before = await portfolioHistory(USER, prisma, { months: 3, now: OCT_6 });
    expect(before).toMatchObject({ from: "2026-08", to: "2026-10" });
    expect(before.months.map((m) => [m.period, m.netWorth, m.contributed, m.netFlow, m.estimated, m.live])).toEqual([
      ["2026-08", 15000, 15000, 5000, true, false],
      ["2026-09", 17000, 17000, 2000, true, false],
      // 200 x 40 + 6k PF cash + 5k PJ cash.
      ["2026-10", 19000, 17000, 0, false, true],
    ]);
    expect(before.months[2]).toMatchObject({ marketValue: 8000, cash: 11000, costBasis: 6000, byClass: { br_stocks: 8000, cash: 11000, fixed_income: 0 } });
    // Every month touches an estimate: nothing to chain yet.
    expect(before.return).toMatchObject({ value: null, months: 0 });

    // Scope: PJ alone is only its cash, never estimated.
    const pj = await portfolioHistory(USER, prisma, { months: 3, now: OCT_6, entityIds: [f.pjId] });
    expect(pj.months.map((m) => [m.netWorth, m.estimated])).toEqual([
      [5000, false],
      [5000, false],
      [5000, false],
    ]);

    // The cron on 6/oct: live month for both entities; September closed at cost (too late for today's prices).
    expect(await snapshotUser(USER, prisma, { now: OCT_6 })).toMatchObject({ live: 2, closed: 2 });
    const rows = await prisma.portfolioSnapshot.findMany({ where: { userId: USER }, orderBy: [{ period: "asc" }, { entityId: "asc" }] });
    const pf = (period: number) => rows.find((r) => r.entityId === f.pfId && r.period === period)!;
    expect(toNumber(pf(202610).marketValueBase)).toBe(8000);
    expect(pf(202610)).toMatchObject({ estimated: false, asOf: OCT_6 });
    expect(pf(202609)).toMatchObject({ estimated: true });
    expect(toNumber(pf(202609).marketValueBase)).toBe(6000);
    expect(pf(202609).asOf.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(rows.find((r) => r.entityId === f.pjId && r.period === 202609)).toMatchObject({ estimated: false });

    // Prices move, then the month turns: October is closed with its last live value, November is live.
    await prisma.investmentHolding.update({ where: { id: petr.id }, data: { currentPrice: 44 } });
    expect(await snapshotUser(USER, prisma, { now: NOV_1 })).toMatchObject({ live: 2, closed: 2 });
    const oct = await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { userId_entityId_period: { userId: USER, entityId: f.pfId, period: 202610 } } });
    expect(oct).toMatchObject({ estimated: false });
    expect(toNumber(oct.marketValueBase)).toBe(8000);
    expect(oct.asOf.toISOString()).toBe("2026-10-31T23:59:59.999Z");
    // Closing again is a no-op.
    expect(await snapshotUser(USER, prisma, { now: NOV_1 })).toMatchObject({ closed: 0 });

    // A November aporte: Modified Dietz takes it out of the gain.
    await deposit(f.pfChecking, f.broker, 1000, "2026-11-03");
    const after = await portfolioHistory(USER, prisma, { months: 2, now: NOV_15 });
    expect(after.months.map((m) => [m.period, m.netWorth, m.netFlow, m.estimated])).toEqual([
      ["2026-10", 19000, 0, false],
      // 200 x 44 + 7k PF cash + 5k PJ cash.
      ["2026-11", 20800, 1000, false],
    ]);
    // October starts from an estimated September, so only November is measured.
    expect(after.months[0].return).toBeNull();
    expect(after.months[1].return).toBeCloseTo(800 / 19500, 10);
    expect(after.return).toMatchObject({ months: 1, from: "2026-11", to: "2026-11" });
    expect(after.return.value).toBeCloseTo(800 / 19500, 10);
  });

  it("backfills past months once, keeps real snapshots and stores the live month", async () => {
    await seed();
    const [first] = await backfillSnapshots(prisma, { userId: USER, now: OCT_6 });
    // PF from July, PJ from August, up to September; PJ rows hold only cash, so they are exact.
    expect(first).toMatchObject({ userId: USER, created: 5, updated: 0, kept: 0 });
    const rows = await prisma.portfolioSnapshot.findMany({ where: { userId: USER }, orderBy: [{ entityId: "asc" }, { period: "asc" }] });
    expect(rows).toHaveLength(7);
    const pfJul = rows.find((r) => r.entityId === f.pfId && r.period === 202607)!;
    expect(pfJul).toMatchObject({ estimated: true });
    expect([pfJul.marketValueBase, pfJul.cashBase, pfJul.costBasisBase, pfJul.contributedBase, pfJul.netFlowBase].map(toNumber)).toEqual([6000, 4000, 6000, 10000, 10000]);
    expect(pfJul.byClass).toMatchObject({ br_stocks: 6000, cash: 4000 });

    const dry = await backfillSnapshots(prisma, { userId: USER, dryRun: true, now: OCT_6 });
    expect(dry[0]).toMatchObject({ created: 0, updated: 3, kept: 2 });
    const [again] = await backfillSnapshots(prisma, { userId: USER, now: OCT_6 });
    expect(again).toMatchObject({ created: 0, updated: 3, kept: 2 });
    expect(await prisma.portfolioSnapshot.count({ where: { userId: USER } })).toBe(7);
  });

  it("adds Total aportado, Resultado and Rentab. 12m to the summary", async () => {
    await seed();
    const summary = await portfolioSummary(USER, prisma);
    expect(summary).toMatchObject({ netWorth: 19000, contributed: 17000, result: 2000 });
    expect(summary.resultPercent).toBeCloseTo(2000 / 17000, 4);
    expect(summary.return12m.months).toEqual(expect.any(Number));
    expect(summary.return12m.value === null || typeof summary.return12m.value === "number").toBe(true);
    expect(summary.return12m).toHaveProperty("cdi");
    expect(summary.return12m).toHaveProperty("ipcaPlus6");
    const pfOnly = await portfolioSummary(USER, prisma, { entityIds: [f.pfId] });
    expect(pfOnly).toMatchObject({ netWorth: 14000, contributed: 12000, result: 2000 });
  });
});
