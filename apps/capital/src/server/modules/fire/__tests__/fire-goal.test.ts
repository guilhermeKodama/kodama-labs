import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { fireGoalDialogBody, patchPhaseContributions } from "@/lib/fire/contribution-edit";
import { moveBrokerageCash } from "@capital/server/modules/investments/services/portfolio";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-fire-goal-001";
const app = createApp();
let cookie: string;
let f: LedgerFixture;

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
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(async () => {
  await prisma.fireGoal.deleteMany({ where: { userId: USER } });
  await prisma.portfolioTarget.deleteMany({ where: { userId: USER } });
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

  it("updates the current phase amount, leaves the rest of the schedule, and undoes", async () => {
    await prisma.portfolioTarget.create({ data: { userId: USER, allocationClass: "br_stocks", targetPercent: 0.2 } });
    const created = await call("PUT", "/v1/fire/goal", {
      ...PLAN,
      planningMode: "by_contribution",
      phaseProfile: "custom",
      targetYear: null,
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 15000, label: "curto" },
        { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
      ],
    });
    expect(created.status).toBe(200);
    expect(created.data.batchId).toEqual(expect.any(String));

    const patch = patchPhaseContributions(
      {
        planningMode: "by_contribution",
        phaseProfile: "custom",
        phases: created.data.phases,
      },
      new Map([[0, 25000]]),
    );
    if (!patch) throw new Error("expected a contribution patch");
    const saved = await call("PUT", "/v1/fire/goal", patch);
    expect(saved.status).toBe(200);
    expect(saved.data.phases).toEqual([
      { fromMonth: 0, toMonth: 15, monthlyContribution: 25000, label: "curto" },
      { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
    ]);
    expect(saved.data).toMatchObject({ planningMode: "by_contribution", phaseProfile: "custom", targetYear: null });
    expect((await call("GET", "/v1/fire/summary")).data.currentMonthContribution).toBe(25000);
    expect(await prisma.portfolioTarget.findMany({ where: { userId: USER } })).toEqual([
      expect.objectContaining({ allocationClass: "br_stocks", targetPercent: 0.2 }),
    ]);

    expect((await call("POST", `/v2/mutations/${saved.data.batchId}/undo`)).status).toBe(200);
    expect((await prisma.fireGoal.findUniqueOrThrow({ where: { userId: USER } })).phases).toEqual([
      { fromMonth: 0, toMonth: 15, monthlyContribution: 15000, label: "curto" },
      { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
    ]);
  });

  it("saving a contribution on a by_date plan switches to by_contribution and uses that amount", async () => {
    const phases = [
      { fromMonth: 0, toMonth: 15, monthlyContribution: 15000, label: "curto" },
      { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
    ];
    await call("PUT", "/v1/fire/goal", { ...PLAN, planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045, phases });
    const patch = patchPhaseContributions(
      { planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045, phases },
      new Map([[0, 25000]]),
      2026,
    );
    if (!patch) throw new Error("expected a contribution patch");
    const saved = await call("PUT", "/v1/fire/goal", patch);
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      planningMode: "by_contribution",
      phaseProfile: "custom",
      targetYear: 2045,
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25000, label: "curto" },
        { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
      ],
    });
    expect((await call("GET", "/v1/fire/summary")).data.currentMonthContribution).toBe(25000);
    await undoBatch(USER, saved.data.batchId, prisma);
    const restored = await prisma.fireGoal.findUniqueOrThrow({ where: { userId: USER } });
    expect(restored).toMatchObject({ planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045 });
    expect(restored.phases).toEqual(phases);
  });

  it("saving only income and return on a by_date plan leaves mode, profile and phases alone", async () => {
    await call("PUT", "/v1/fire/goal", PLAN);
    const solved = [
      { ...PLAN.phases[0], monthlyContribution: 22000 },
      { ...PLAN.phases[1], monthlyContribution: 9000 },
    ];
    const baselineTexts = ["22000", "9000"];
    const body = fireGoalDialogBody({
      fields: { targetMonthlyIncome: 18000, nominalAnnualReturn: 0.08 },
      goal: { planningMode: "by_date", phaseProfile: "custom", targetYear: 2045, phases: PLAN.phases },
      solvedPhases: solved,
      texts: baselineTexts,
      baselineTexts,
      parseNumber: Number,
      nowYear: 2026,
    });
    expect(body).toEqual({ targetMonthlyIncome: 18000, nominalAnnualReturn: 0.08 });

    const saved = await call("PUT", "/v1/fire/goal", body);
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      targetMonthlyIncome: 18000,
      nominalAnnualReturn: 0.08,
      planningMode: "by_date",
      phaseProfile: "custom",
      targetYear: 2045,
      phases: PLAN.phases,
    });
  });

  it("a by_date plan with a past target year updates the amount and does not switch", async () => {
    const phases = [
      { fromMonth: 0, toMonth: 15, monthlyContribution: 15000, label: "curto" },
      { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
    ];
    await call("PUT", "/v1/fire/goal", { ...PLAN, planningMode: "by_date", phaseProfile: "constant", targetYear: 2020, phases });
    const patch = patchPhaseContributions(
      { planningMode: "by_date", phaseProfile: "constant", targetYear: 2020, phases },
      new Map([[0, 25000]]),
      2026,
    );
    expect(patch).toEqual({
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25000, label: "curto" },
        phases[1],
      ],
    });
    const saved = await call("PUT", "/v1/fire/goal", patch);
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      planningMode: "by_date",
      phaseProfile: "constant",
      targetYear: 2020,
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25000, label: "curto" },
        { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
      ],
    });
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

describe("FIRE base", () => {
  it("counts the brokers' cash as invested, like the Carteira's Patrimônio", async () => {
    await call("PUT", "/v1/fire/goal", { ...PLAN, planningMode: "by_contribution", targetYear: null });
    const before = (await call("GET", "/v1/fire/summary")).data.result.currentInvested;
    const deposit = await moveBrokerageCash(USER, { accountId: f.broker, amount: 2500, date: "2026-09-10", direction: "deposit" }, prisma);
    try {
      const after = (await call("GET", "/v1/fire/summary")).data.result.currentInvested;
      expect(after - before).toBeCloseTo(2500, 6);
    } finally {
      await prisma.ledgerEntry.deleteMany({ where: { transferGroupId: deposit.transferGroupId! } });
      await prisma.transferGroup.deleteMany({ where: { id: deposit.transferGroupId! } });
    }
  });
});
