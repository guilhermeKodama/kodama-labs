import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-fire-goal-001";
const app = createApp();
let cookie: string;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const PLAN = {
  targetMonthlyIncome: 20000,
  safeWithdrawalRate: 0.04,
  nominalAnnualReturn: 0.1,
  annualInflation: 0.04,
  monthlyIncome: 30000,
  planningMode: "by_date",
  targetYear: 2045,
  phaseProfile: "custom",
  phases: [
    { fromMonth: 0, toMonth: 60, monthlyContribution: 8000, label: "Agora" },
    { fromMonth: 60, toMonth: null, monthlyContribution: 4000 },
  ],
  includeBusinessInvestments: true,
  currentAge: 35,
};

beforeAll(async () => {
  await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(async () => {
  await prisma.fireGoal.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("PUT /v1/fire/goal", () => {
  it("merges a partial body into the stored plan instead of replacing it", async () => {
    expect((await call("PUT", "/v1/fire/goal", PLAN)).status).toBe(200);

    // What the Aportes dialog sends: only the income target and the SWR.
    const { status, data } = await call("PUT", "/v1/fire/goal", { targetMonthlyIncome: 15000, safeWithdrawalRate: 0.035 });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      targetMonthlyIncome: 15000,
      safeWithdrawalRate: 0.035,
      planningMode: "by_date",
      targetYear: 2045,
      phaseProfile: "custom",
      phases: PLAN.phases,
      monthlyIncome: 30000,
      includeBusinessInvestments: true,
      currentAge: 35,
      // Defaults from the creation are kept too.
      lifeExpectancyAge: 95,
      withdrawalStrategy: "perpetuity",
    });

    // An explicit null clears a nullable field; nothing else moves.
    const cleared = await call("PUT", "/v1/fire/goal", { monthlyIncome: null });
    expect(cleared.data).toMatchObject({ monthlyIncome: null, targetYear: 2045, phases: PLAN.phases });
  });

  it("needs the core fields to create a plan, and validates the merged one", async () => {
    const missing = await call("PUT", "/v1/fire/goal", { targetMonthlyIncome: 15000 });
    expect(missing.status).toBe(422);
    expect(missing.data.code).toBe("fire.goal_incomplete");
    expect(await prisma.fireGoal.count({ where: { userId: USER } })).toBe(0);

    const invalid = await call("PUT", "/v1/fire/goal", { ...PLAN, safeWithdrawalRate: 2 });
    expect(invalid.status).toBe(422);
    expect(invalid.data.code).toBe("validation");

    await call("PUT", "/v1/fire/goal", PLAN);
    const emptyPhases = await call("PUT", "/v1/fire/goal", { phases: [] });
    expect(emptyPhases.status).toBe(422);
    expect((await prisma.fireGoal.findUniqueOrThrow({ where: { userId: USER } })).phases).toEqual(PLAN.phases);
  });
});

describe("GET /v1/fire/summary", () => {
  it("has no contribution figures without a plan", async () => {
    const { data } = await call("GET", "/v1/fire/summary?altContribution=1000");
    expect(data).toMatchObject({ hasGoal: false, currentMonthContribution: null, altProjection: null });
  });

  it("gives this month's planned contribution and the FIRE date at another monthly amount", async () => {
    await call("PUT", "/v1/fire/goal", { ...PLAN, planningMode: "by_contribution", targetYear: null });
    const plain = await call("GET", "/v1/fire/summary");
    expect(plain.status).toBe(200);
    // By contribution, the current phase is the stored one.
    expect(plain.data).toMatchObject({ currentMonthContribution: 8000, altProjection: null });

    const more = (await call("GET", "/v1/fire/summary?altContribution=20000")).data.altProjection;
    const less = (await call("GET", "/v1/fire/summary?altContribution=2000")).data.altProjection;
    expect(more).toMatchObject({ monthlyContribution: 20000 });
    expect(more.projectedFireDate).toEqual(expect.any(String));
    expect(more.monthsToFire).toBeLessThan(less.monthsToFire);
    expect(new Date(more.projectedFireDate).getTime()).toBeLessThan(new Date(less.projectedFireDate).getTime());

    // Planning by date, the contribution is the prescribed one for the current phase.
    await call("PUT", "/v1/fire/goal", { planningMode: "by_date", targetYear: 2045 });
    const byDate = (await call("GET", "/v1/fire/summary")).data;
    expect(byDate.requiredContribution.phases[0].monthlyContribution).toBeCloseTo(byDate.currentMonthContribution, 6);

    expect((await call("GET", "/v1/fire/summary?altContribution=-1")).status).toBe(422);
  });
});
