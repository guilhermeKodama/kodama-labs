import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { upsertFireGoal } from "@capital/server/modules/fire/services/upsert-fire-goal";
import type { FireGoalPatch } from "@capital/server/modules/fire/validations/fire";
import { undoBatch, withMutationSource } from "@capital/server/modules/ledger/services/mutations";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { getFirePlan, updateFirePhaseContribution } from "../fire";

const USER = "test-user-mcp-fire-001";
const OTHER = "test-user-mcp-fire-002";

const PLAN = {
  targetMonthlyIncome: 20000,
  safeWithdrawalRate: 0.04,
  nominalAnnualReturn: 0.1,
  annualInflation: 0.04,
  planningMode: "by_date",
  targetYear: 2045,
  phaseProfile: "front_loaded",
  phases: [
    { fromMonth: 0, toMonth: 15, monthlyContribution: 15000, label: "curto" },
    { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
  ],
  currency: "BRL",
} satisfies FireGoalPatch;

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  await prisma.fireGoal.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  await prisma.portfolioTarget.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("FIRE MCP tools", () => {
  it("reads an empty plan without writing a snapshot", async () => {
    expect(await getFirePlan(USER, prisma)).toMatchObject({
      hasGoal: false,
      phases: [],
      currentPhaseIndex: null,
      currentMonthContribution: null,
    });
    expect(await prisma.fireSnapshot.count({ where: { goal: { userId: USER } } })).toBe(0);
  });

  it("updates the current phase, switches by_date to by_contribution, and undoes", async () => {
    await prisma.portfolioTarget.create({ data: { userId: USER, allocationClass: "fixed_income", targetPercent: 0.35 } });
    await upsertFireGoal(USER, PLAN, prisma);

    const before = await getFirePlan(USER, prisma);
    expect(before).toMatchObject({
      hasGoal: true,
      planningMode: "by_date",
      phaseProfile: "front_loaded",
      currentPhaseIndex: 0,
      phases: PLAN.phases,
    });
    expect(await prisma.fireSnapshot.count({ where: { goal: { userId: USER } } })).toBe(0);

    const updated = await withMutationSource("mcp", () =>
      updateFirePhaseContribution(USER, { monthlyContribution: 25000 }, prisma),
    );
    expect(updated).toMatchObject({
      planningMode: "by_contribution",
      phaseProfile: "custom",
      targetYear: 2045,
      updatedPhaseIndex: 0,
      currentPhaseIndex: 0,
      currentMonthContribution: 25000,
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25000, label: "curto" },
        { fromMonth: 15, toMonth: null, monthlyContribution: 8000, label: "depois" },
      ],
    });
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: updated.batchId } })).toMatchObject({
      source: "mcp",
      op: "update",
    });
    expect(await prisma.portfolioTarget.findMany({ where: { userId: USER } })).toEqual([
      expect.objectContaining({ allocationClass: "fixed_income", targetPercent: 0.35 }),
    ]);

    const after = await getFirePlan(USER, prisma);
    expect(after.currentMonthContribution).toBe(25000);
    expect(after.planningMode).toBe("by_contribution");

    await undoBatch(USER, updated.batchId, prisma);
    const restored = await prisma.fireGoal.findUniqueOrThrow({ where: { userId: USER } });
    expect(restored).toMatchObject({ planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045 });
    expect(restored.phases).toEqual(PLAN.phases);
  });

  it("updates a chosen phase and rejects a missing plan or a bad index", async () => {
    await upsertFireGoal(USER, { ...PLAN, planningMode: "by_contribution", phaseProfile: "custom", targetYear: null }, prisma);
    const second = await updateFirePhaseContribution(USER, { phaseIndex: 1, monthlyContribution: 4000 }, prisma);
    expect(second.phases[0]).toMatchObject({ monthlyContribution: 15000, label: "curto", fromMonth: 0, toMonth: 15 });
    expect(second.phases[1]).toMatchObject({ monthlyContribution: 4000, label: "depois" });
    expect(second.phaseProfile).toBe("custom");

    await expect(updateFirePhaseContribution(OTHER, { monthlyContribution: 1 }, prisma)).rejects.toThrow(/No FIRE plan/);
    await expect(updateFirePhaseContribution(USER, { phaseIndex: 4, monthlyContribution: 1 }, prisma)).rejects.toThrow(/outside 0–1/);
  });
});
