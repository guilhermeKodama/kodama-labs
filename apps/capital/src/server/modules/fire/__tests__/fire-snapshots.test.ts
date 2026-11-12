import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FireGoal, FireSnapshot } from "@/generated/prisma";
import { getUserToday } from "@capital/server/lib/date-utils";
import { prisma, type DbClient } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { recordFireSnapshot } from "../data/commands/record-fire-snapshot";
import { upsertFireGoal as upsertFireGoalCommand } from "../data/commands/upsert-fire-goal";
import { fetchFireInputs } from "../data/queries/fetch-fire-inputs";
import { listFireSnapshots } from "../services/list-fire-snapshots";
import { deleteSnapshot, upsertManualSnapshot } from "../services/manage-snapshots";
import { recordCurrentSnapshot } from "../services/record-current-snapshot";
import { recordMonthlySnapshots } from "../services/record-monthly-snapshots";
import { finite, serializeDate, serializeGoal, serializeSnapshot } from "../services/serialize";
import { upsertFireGoal } from "../services/upsert-fire-goal";
import { TRAILING_MONTHS } from "../constants";
import type { FireGoalPatch } from "../validations/fire";

const USER = "test-user-fire-snapshots-001";
const OTHER = "test-user-fire-snapshots-002";
const THIRD = "test-user-fire-snapshots-003";
const app = createApp();

let f: LedgerFixture;
let other: LedgerFixture;
let cookie: string;

const PLAN = {
  targetMonthlyIncome: 10000,
  safeWithdrawalRate: 0.04,
  nominalAnnualReturn: 0.1,
  annualInflation: 0.04,
  planningMode: "by_contribution",
  phaseProfile: "custom",
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 3000 }],
} satisfies FireGoalPatch;
// 10000 * 12 / 0.04
const FIRE_NUMBER = 3_000_000;

const login = async (userId: string) => `capital_session=${(await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } })).id}`;

async function call(method: string, path: string, body?: unknown, as: string | null = cookie) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(as && { cookie: as }), ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** The month the app is in for a user on the default timezone (the one the fixture users have). */
const thisPeriod = () => {
  const now = getUserToday("America/Sao_Paulo");
  return now.getFullYear() * 100 + now.getMonth() + 1;
};

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  cookie = await login(USER);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const id of [USER, OTHER, THIRD]) await deleteLedgerFixture(prisma, id);
});

const goalOf = (userId: string) => prisma.fireGoal.findUniqueOrThrow({ where: { userId } });
const snapshotsOf = (goalId: string) => prisma.fireSnapshot.findMany({ where: { goalId }, orderBy: { period: "asc" } });

async function withHolding(userId: string, accountId: string, value: number, ticker = "PETR4") {
  const holding = await createHolding(userId, { accountId, assetClass: "stocks", ticker, name: ticker, currency: "BRL" }, prisma);
  await prisma.investmentHolding.update({ where: { id: holding.id }, data: { currentQuantity: 1, currentPrice: value, totalInvested: value } });
  return holding;
}

describe("snapshot endpoints without a plan", () => {
  it("answer 401 without a session", async () => {
    for (const [method, path, body] of [
      ["GET", "/v1/fire/snapshots"],
      ["POST", "/v1/fire/snapshot"],
      ["PUT", "/v1/fire/snapshots/202601", { currentInvested: 1 }],
      ["DELETE", "/v1/fire/snapshots/202601"],
    ] as const) {
      expect((await call(method, path, body, null)).status, `${method} ${path}`).toBe(401);
    }
  });

  it("list nothing, refuse to record, and report that nothing was deleted", async () => {
    expect(await call("GET", "/v1/fire/snapshots")).toEqual({ status: 200, body: [] });
    expect(await call("POST", "/v1/fire/snapshot")).toMatchObject({ status: 400, body: { code: "fire.no_plan", message: "No FIRE plan to snapshot" } });
    expect(await call("PUT", "/v1/fire/snapshots/202601", { currentInvested: 1000 })).toMatchObject({ status: 400, body: { code: "fire.no_plan" } });
    expect(await call("DELETE", "/v1/fire/snapshots/202601")).toEqual({ status: 200, body: { success: false } });
    expect(await prisma.fireSnapshot.count({ where: { goal: { userId: USER } } })).toBe(0);
  });

  it("return the services' empty results too", async () => {
    expect(await listFireSnapshots(USER, prisma)).toEqual([]);
    expect(await upsertManualSnapshot(USER, 202601, { currentInvested: 5 }, prisma)).toBeNull();
    expect(await deleteSnapshot(USER, 202601, prisma)).toBe(false);
    expect(await recordCurrentSnapshot(USER, prisma)).toBeNull();
  });
});

describe("manual snapshots", () => {
  beforeEach(async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
  });

  it("PUT backfills a month: noon UTC on its first day, the fire number from the plan, progress from the invested amount", async () => {
    const { status, body } = await call("PUT", "/v1/fire/snapshots/202403", { currentInvested: 600_000, currentMonthlyExpenses: 4200 });

    expect(status).toBe(200);
    expect(body).toEqual({
      period: 202403,
      snapshotDate: "2024-03-01T12:00:00.000Z",
      currentInvested: 600_000,
      currentMonthlyExpenses: 4200,
      fireNumber: FIRE_NUMBER,
      progress: 0.2,
      monthsToFire: null,
      projectedFireDate: null,
    });
    expect(await snapshotsOf((await goalOf(USER)).id)).toHaveLength(1);
  });

  it("PUT defaults the expenses to zero and replaces an existing month instead of adding a second", async () => {
    await call("PUT", "/v1/fire/snapshots/202403", { currentInvested: 100, currentMonthlyExpenses: 50 });
    const again = await call("PUT", "/v1/fire/snapshots/202403", { currentInvested: 1_500_000 });

    expect(again.body).toMatchObject({ currentInvested: 1_500_000, currentMonthlyExpenses: 0, progress: 0.5 });
    const rows = await snapshotsOf((await goalOf(USER)).id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: 202403, currentInvested: 1_500_000, currentMonthlyExpenses: 0 });
  });

  it("PUT follows the plan's fire number when the plan changes, and shows zero progress for an empty month", async () => {
    await upsertFireGoal(USER, { targetMonthlyIncome: 20000 }, prisma);
    const body = (await call("PUT", "/v1/fire/snapshots/202312", { currentInvested: 0 })).body;
    expect(body).toMatchObject({ fireNumber: 2 * FIRE_NUMBER, progress: 0, snapshotDate: "2023-12-01T12:00:00.000Z" });
  });

  it("PUT records zero progress when the stored plan's number is zero", async () => {
    await prisma.fireGoal.update({ where: { userId: USER }, data: { targetMonthlyIncome: 0 } });
    expect((await call("PUT", "/v1/fire/snapshots/202403", { currentInvested: 500 })).body).toMatchObject({ fireNumber: 0, progress: 0, currentInvested: 500 });
  });

  it("PUT validates the period and the amounts", async () => {
    expect((await call("PUT", "/v1/fire/snapshots/1800", { currentInvested: 1 })).status).toBe(422);
    expect((await call("PUT", "/v1/fire/snapshots/20240", { currentInvested: 1 })).status).toBe(422);
    expect((await call("PUT", "/v1/fire/snapshots/abc", { currentInvested: 1 })).status).toBe(422);
    expect((await call("PUT", "/v1/fire/snapshots/202403", { currentInvested: -1 })).status).toBe(422);
    expect((await call("PUT", "/v1/fire/snapshots/202403", {})).status).toBe(422);
    expect(await prisma.fireSnapshot.count({ where: { goal: { userId: USER } } })).toBe(0);
  });

  it("GET lists the snapshots oldest first with ISO dates", async () => {
    await call("PUT", "/v1/fire/snapshots/202405", { currentInvested: 300_000 });
    await call("PUT", "/v1/fire/snapshots/202401", { currentInvested: 150_000 });
    const goal = await goalOf(USER);
    await prisma.fireSnapshot.update({
      where: { goalId_period: { goalId: goal.id, period: 202405 } },
      data: { monthsToFire: 120, projectedFireDate: new Date("2034-05-01T12:00:00.000Z") },
    });

    const { status, body } = await call("GET", "/v1/fire/snapshots");

    expect(status).toBe(200);
    expect(body.map((row: { period: number }) => row.period)).toEqual([202401, 202405]);
    expect(body[0]).toMatchObject({ snapshotDate: "2024-01-01T12:00:00.000Z", projectedFireDate: null, monthsToFire: null });
    expect(body[1]).toMatchObject({ monthsToFire: 120, projectedFireDate: "2034-05-01T12:00:00.000Z", progress: 0.1 });
  });

  it("DELETE removes only that month of the caller's plan", async () => {
    await upsertFireGoal(OTHER, { ...PLAN }, prisma);
    await call("PUT", "/v1/fire/snapshots/202401", { currentInvested: 1 });
    await call("PUT", "/v1/fire/snapshots/202402", { currentInvested: 2 });
    const theirs = await upsertManualSnapshot(OTHER, 202401, { currentInvested: 9 }, prisma);

    expect(await call("DELETE", "/v1/fire/snapshots/202401")).toEqual({ status: 200, body: { success: true } });

    expect((await snapshotsOf((await goalOf(USER)).id)).map((row) => row.period)).toEqual([202402]);
    expect((await prisma.fireSnapshot.findMany({ where: { goal: { userId: OTHER } } })).map((row) => row.currentInvested)).toEqual([9]);
    expect(theirs?.period).toBe(202401);
    // A month that has no snapshot is not an error.
    expect(await call("DELETE", "/v1/fire/snapshots/199901")).toEqual({ status: 200, body: { success: true } });
    expect((await call("DELETE", "/v1/fire/snapshots/1999")).status).toBe(422);
  });
});

describe("this month's snapshot", () => {
  beforeEach(async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
  });

  it("POST refreshes this month's snapshot with what the portfolio holds now, while reading the summary keeps the first one", async () => {
    await withHolding(USER, f.broker, 30_000);
    const first = await call("GET", "/v1/fire/summary");
    expect(first.body.result.currentInvested).toBe(30_000);
    const goal = await goalOf(USER);
    expect((await snapshotsOf(goal.id)).map((row) => [row.period, row.currentInvested])).toEqual([[thisPeriod(), 30_000]]);

    await withHolding(USER, f.broker, 20_000, "VALE3");
    await call("GET", "/v1/fire/summary");
    expect((await snapshotsOf(goal.id))[0]?.currentInvested).toBe(30_000);

    const refreshed = await call("POST", "/v1/fire/snapshot");

    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ period: thisPeriod(), currentInvested: 50_000, fireNumber: FIRE_NUMBER });
    expect(refreshed.body.progress).toBeCloseTo(50_000 / FIRE_NUMBER, 10);
    const rows = await snapshotsOf(goal.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentInvested).toBe(50_000);
  });

  it("returns the latest snapshot when older months exist, listing all of them", async () => {
    await call("PUT", "/v1/fire/snapshots/202001", { currentInvested: 5 });
    const latest = await recordCurrentSnapshot(USER, prisma);
    expect(latest?.period).toBe(thisPeriod());
    expect((await listFireSnapshots(USER, prisma)).map((row) => row.period)).toEqual([202001, thisPeriod()]);
  });
});

describe("recordMonthlySnapshots", () => {
  const SNAPSHOT_DATE = new Date("2026-09-30T12:00:00.000Z");
  const PERIOD = 202609;

  /**
   * The cron records for every plan in the database: this client only sees the given users' plans, so other
   * tests' plans stay untouched. `failFor` makes reading that user reject, as a dropped connection would.
   */
  function scopedDb(userIds: string[], failFor?: string): DbClient {
    return new Proxy(prisma, {
      get(target, prop) {
        if (prop === "fireGoal") return { findMany: (args: object) => target.fireGoal.findMany({ ...args, where: { userId: { in: userIds } } }) };
        if (prop === "user" && failFor) {
          return {
            findUnique: (args: { where: { id: string } }) =>
              args.where.id === failFor ? Promise.reject(new Error("database went away")) : target.user.findUnique(args as never),
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as DbClient;
  }

  it("records the period for every plan, from each user's own portfolio and spending", async () => {
    await createLedgerFixture(prisma, THIRD);
    await upsertFireGoal(USER, { ...PLAN }, prisma);
    await upsertFireGoal(OTHER, { ...PLAN, targetMonthlyIncome: 5000, safeWithdrawalRate: 0.05 }, prisma);
    await withHolding(USER, f.broker, 150_000);
    await withHolding(OTHER, other.broker, 12_000);
    const today = new Date();
    today.setDate(today.getDate() - 20);
    await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
    await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: -600,
        currency: "BRL",
        exchangeRate: 1,
        amountBase: -600,
        date: today,
        effectiveDate: today,
        description: "Aluguel",
      },
    });

    const result = await recordMonthlySnapshots(scopedDb([USER, OTHER, THIRD]), { period: PERIOD, snapshotDate: SNAPSHOT_DATE });

    // THIRD has no plan, so two of the three users count.
    expect(result).toEqual({ recorded: 2, total: 2 });
    const mine = (await snapshotsOf((await goalOf(USER)).id))[0]!;
    expect(mine).toMatchObject({ period: PERIOD, currentInvested: 150_000, fireNumber: FIRE_NUMBER, monthsToFire: null, projectedFireDate: null });
    expect(mine.snapshotDate.toISOString()).toBe(SNAPSHOT_DATE.toISOString());
    expect(mine.progress).toBeCloseTo(0.05, 10);
    expect(mine.currentMonthlyExpenses).toBeCloseTo(600 / TRAILING_MONTHS, 6);
    const theirs = (await snapshotsOf((await goalOf(OTHER)).id))[0]!;
    // 5000 * 12 / 0.05
    expect(theirs).toMatchObject({ period: PERIOD, currentInvested: 12_000, fireNumber: 1_200_000, currentMonthlyExpenses: 0 });
    expect(theirs.progress).toBeCloseTo(0.01, 10);
  });

  it("refreshes a month it already recorded", async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
    const db = scopedDb([USER]);
    await recordMonthlySnapshots(db, { period: PERIOD, snapshotDate: SNAPSHOT_DATE });
    await withHolding(USER, f.broker, 60_000);

    const result = await recordMonthlySnapshots(db, { period: PERIOD, snapshotDate: SNAPSHOT_DATE });

    expect(result).toEqual({ recorded: 1, total: 1 });
    const rows = await snapshotsOf((await goalOf(USER)).id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentInvested).toBe(60_000);
  });

  it("counts business holdings only when the plan includes them", async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Inter PJ", currency: "BRL" } });
    await withHolding(USER, f.broker, 10_000, "PETR4");
    await withHolding(USER, pjBroker.id, 7_000, "VALE3");
    await upsertFireGoal(USER, { ...PLAN, includeBusinessInvestments: false }, prisma);
    const db = scopedDb([USER]);

    await recordMonthlySnapshots(db, { period: PERIOD, snapshotDate: SNAPSHOT_DATE });
    expect((await snapshotsOf((await goalOf(USER)).id))[0]?.currentInvested).toBe(10_000);

    await upsertFireGoal(USER, { includeBusinessInvestments: true }, prisma);
    await recordMonthlySnapshots(db, { period: PERIOD, snapshotDate: SNAPSHOT_DATE });
    expect((await snapshotsOf((await goalOf(USER)).id))[0]?.currentInvested).toBe(17_000);
  });

  it("reports a plan it cannot record and carries on with the rest", async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
    await upsertFireGoal(OTHER, { ...PLAN }, prisma);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recordMonthlySnapshots(scopedDb([USER, OTHER], USER), { period: PERIOD, snapshotDate: SNAPSHOT_DATE });

    expect(result).toEqual({ recorded: 1, total: 2 });
    const failedGoal = await goalOf(USER);
    expect(logged).toHaveBeenCalledWith(`[FireSnapshot] failed for goal ${failedGoal.id}:`, expect.objectContaining({ message: "database went away" }));
    expect(await snapshotsOf(failedGoal.id)).toEqual([]);
    expect(await snapshotsOf((await goalOf(OTHER)).id)).toHaveLength(1);
  });

  it("records zero progress when the plan's fire number is zero", async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
    await prisma.fireGoal.update({ where: { userId: USER }, data: { targetMonthlyIncome: 0 } });
    await withHolding(USER, f.broker, 1_000);

    await recordMonthlySnapshots(scopedDb([USER]), { period: PERIOD, snapshotDate: SNAPSHOT_DATE });

    expect((await snapshotsOf((await goalOf(USER)).id))[0]).toMatchObject({ fireNumber: 0, progress: 0, currentInvested: 1_000 });
  });
});

describe("recordFireSnapshot", () => {
  const data = (currentInvested: number) => ({
    snapshotDate: new Date("2026-01-01T12:00:00.000Z"),
    currentInvested,
    currentMonthlyExpenses: 10,
    fireNumber: 100,
    progress: 0.5,
    monthsToFire: 12,
    projectedFireDate: new Date("2027-01-01T12:00:00.000Z"),
  });

  it("creates the month once and leaves it alone unless forced", async () => {
    const goal = await upsertFireGoal(USER, { ...PLAN }, prisma);
    await recordFireSnapshot(goal.id, 202601, data(1), false, prisma);
    await recordFireSnapshot(goal.id, 202601, data(2), false, prisma);
    expect((await snapshotsOf(goal.id)).map((row) => row.currentInvested)).toEqual([1]);

    await recordFireSnapshot(goal.id, 202601, data(3), true, prisma);
    const rows = await snapshotsOf(goal.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currentInvested: 3, monthsToFire: 12 });
    expect(rows[0]?.projectedFireDate?.toISOString()).toBe("2027-01-01T12:00:00.000Z");
  });
});

describe("upsertFireGoal", () => {
  it("rejects a patch that merges into an invalid stored plan, and writes nothing", async () => {
    await upsertFireGoal(USER, { ...PLAN }, prisma);
    // A plan saved before a rule existed: the stored row is no longer valid on its own.
    await prisma.fireGoal.update({ where: { userId: USER }, data: { phases: [] } });
    const before = await goalOf(USER);

    const error = await upsertFireGoal(USER, { name: "Novo nome" }, prisma).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(LedgerError);
    expect(error).toMatchObject({ status: 422, code: "validation" });
    expect((error as LedgerError).message).toMatch(/^The merged FIRE plan is invalid: phases:/);
    expect((await goalOf(USER)).updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect((await call("PUT", "/v1/fire/goal", { name: "Novo nome" })).body).toMatchObject({ code: "validation" });
  });

  it("stores a plan with no age as null and keeps explicit nulls for the optional fields", async () => {
    const saved = await upsertFireGoalCommand(
      USER,
      {
        ...PLAN,
        phases: [...PLAN.phases],
        leanMultiplier: 0.7,
        fatMultiplier: 1.6,
        includeEntityBalances: false,
        includeBusinessInvestments: false,
        currency: "BRL",
        lifeExpectancyAge: 95,
        annualVolatility: 0.12,
        milestones: [],
        withdrawalStrategy: "perpetuity",
      },
      prisma,
    );
    expect(saved).toMatchObject({ currentAge: null, retirementAge: null, targetYear: null, monthlyIncome: null, baristaMonthlyIncome: null, coastStopYear: null, name: null });
  });
});

describe("serialize", () => {
  it("turns an unreachable (infinite) number into null and dates into ISO strings", () => {
    expect(finite(12.5)).toBe(12.5);
    expect(finite(0)).toBe(0);
    expect(finite(Infinity)).toBeNull();
    expect(finite(-Infinity)).toBeNull();
    expect(finite(NaN)).toBeNull();
    expect(serializeDate(null)).toBeNull();
    expect(serializeDate(new Date("2026-02-03T04:05:06.000Z"))).toBe("2026-02-03T04:05:06.000Z");
  });

  it("serializes a snapshot with and without a projected date", () => {
    const snap = { period: 202601, snapshotDate: new Date("2026-01-01T12:00:00.000Z"), currentInvested: 1, currentMonthlyExpenses: 2, fireNumber: 3, progress: 0.3, monthsToFire: 4, projectedFireDate: null } as FireSnapshot;
    expect(serializeSnapshot(snap)).toEqual({ ...snap, snapshotDate: "2026-01-01T12:00:00.000Z", projectedFireDate: null });
    expect(serializeSnapshot({ ...snap, projectedFireDate: new Date("2030-06-01T12:00:00.000Z") }).projectedFireDate).toBe("2030-06-01T12:00:00.000Z");
  });

  it("serializes a plan whose JSON columns are empty as empty lists", async () => {
    const goal = await upsertFireGoal(USER, { ...PLAN }, prisma);
    const stored = await goalOf(USER);
    const asRow = (extra: Partial<FireGoal>) => ({ ...stored, ...extra }) as FireGoal;
    const bare = serializeGoal(asRow({ phases: null as never, milestones: null as never }));
    expect(bare.phases).toEqual([]);
    expect(bare.milestones).toEqual([]);
    const full = serializeGoal(stored);
    expect(full).toMatchObject({ id: goal.id, targetMonthlyIncome: 10000, phases: PLAN.phases, milestones: [], currency: "BRL" });
    expect(full.createdAt).toBe(stored.createdAt.toISOString());
  });
});

describe("fetchFireInputs", () => {
  it("falls back to BRL and São Paulo for a user that does not exist, with nothing in it", async () => {
    const inputs = await fetchFireInputs("test-user-fire-snapshots-missing", prisma, { trailingMonths: 6 });
    expect(inputs).toEqual({ baseCurrency: "BRL", timezone: "America/Sao_Paulo", holdings: [], currencyRates: { BRL: 1 }, expenses: [], contributions: [], income: [] });
  });

  it("derives rates from the manual ones but never lets the base currency be overridden or a zero rate through", async () => {
    await prisma.currency.createMany({
      data: [
        { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 0.2 },
        { userId: USER, code: "BRL", name: "Real", symbol: "R$", manualRate: 0.18 },
        { userId: USER, code: "EUR", name: "Euro", symbol: "€", manualRate: 0 },
      ],
    });
    const inputs = await fetchFireInputs(USER, prisma, { trailingMonths: 6 });
    expect(inputs.currencyRates).toEqual({ BRL: 1, USD: 5 });
  });

  it("counts a brokerage's positive cash as a holding of its own, ignores an overdraft and skips archived brokers", async () => {
    await prisma.account.update({ where: { id: f.broker }, data: { initialBalance: 2500 } });
    await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Negativa", currency: "BRL", initialBalance: -100 } });
    await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Fechada", currency: "BRL", initialBalance: 999, archivedAt: new Date() } });
    await withHolding(USER, f.broker, 4_000);

    const inputs = await fetchFireInputs(USER, prisma, { trailingMonths: 6 });

    expect(inputs.holdings).toHaveLength(2);
    expect(inputs.holdings[0]).toMatchObject({ currentQuantity: 1, currentPrice: 4_000, totalInvested: 4_000, entityType: "personal" });
    expect(inputs.holdings[1]).toEqual({ currentQuantity: 0, currentPrice: null, totalInvested: 2500, currency: "BRL", entityType: "personal" });
  });

  it("returns expenses, contributions and income inside the window, signed for the engine, with a null category when there is none", async () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 10);
    const old = new Date();
    old.setMonth(old.getMonth() - 9);
    const entry = (kind: string, amount: number, date: Date, description: string, categoryId: string | null, accountId = f.pfChecking) =>
      prisma.ledgerEntry.create({
        data: { userId: USER, entityId: f.pfId, accountId, kind: kind as never, amount, currency: "BRL", exchangeRate: 1, amountBase: amount, date, effectiveDate: date, description, categoryId },
      });
    await entry("expense", -80, recent, "Mercado", f.categories.Groceries!);
    await entry("expense", -20, recent, "Sem categoria", null);
    await entry("expense", -500, old, "Antigo", f.categories.Groceries!);
    await entry("income", 1000, recent, "Salário", f.categories.Salary!);
    await entry("investment", -300, recent, "Aporte", null);
    await entry("investment", 50, recent, "Provento recebido", null);

    const inputs = await fetchFireInputs(USER, prisma, { trailingMonths: 6 });

    expect(inputs.expenses.map((row) => [row.amount, row.category]).sort()).toEqual([[20, null], [80, "Groceries"]].sort());
    expect(inputs.expenses.every((row) => row.exchangeRate === 1 && row.date instanceof Date)).toBe(true);
    expect(inputs.contributions.map((row) => row.amount)).toEqual([300]);
    expect(inputs.income.map((row) => [row.amount, row.category])).toEqual([[1000, "Salary"]]);
  });
});
