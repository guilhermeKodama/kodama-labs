import { describe, expect, it } from "vitest";
import { createFormatter } from "@/lib/format/formatter";
import {
  currentPhaseIndex,
  fireGoalDialogBody,
  parseContributionText,
  patchPhaseContributions,
  phasesShownForContributionEdit,
  phaseMonthRange,
} from "../contribution-edit";
import type { ContributionPhase } from "../types";

const phases: ContributionPhase[] = [
  { fromMonth: 0, toMonth: 15, monthlyContribution: 15_000, label: "curto" },
  { fromMonth: 15, toMonth: null, monthlyContribution: 8_000, label: "depois" },
];

describe("currentPhaseIndex", () => {
  it("picks the phase that covers month 0", () => {
    expect(currentPhaseIndex(phases)).toBe(0);
    expect(currentPhaseIndex(phases, 15)).toBe(1);
    expect(currentPhaseIndex(phases, 40)).toBe(1);
  });

  it("uses the last phase when month 0 is before the schedule", () => {
    expect(currentPhaseIndex([{ fromMonth: 4, toMonth: null, monthlyContribution: 1 }])).toBe(0);
    expect(
      currentPhaseIndex([
        { fromMonth: 4, toMonth: 10, monthlyContribution: 1, label: "curto" },
        { fromMonth: 10, toMonth: null, monthlyContribution: 2 },
      ]),
    ).toBe(1);
  });

  it("is -1 with no phases", () => {
    expect(currentPhaseIndex([])).toBe(-1);
  });
});

describe("phaseMonthRange", () => {
  it("describes open, single-month and multi-month offsets", () => {
    expect(phaseMonthRange({ fromMonth: 0, toMonth: null })).toEqual({ kind: "open", from: 0 });
    expect(phaseMonthRange({ fromMonth: 15, toMonth: 16 })).toEqual({ kind: "month", month: 15 });
    expect(phaseMonthRange({ fromMonth: 0, toMonth: 15 })).toEqual({ kind: "span", from: 0, months: 15 });
  });
});

describe("patchPhaseContributions", () => {
  it("changes one amount and copies bounds and labels", () => {
    const patch = patchPhaseContributions(
      { planningMode: "by_contribution", phaseProfile: "custom", phases },
      new Map([[0, 25_000]]),
    );
    expect(patch).toEqual({
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25_000, label: "curto" },
        phases[1],
      ],
    });
    expect(phases[0].monthlyContribution).toBe(15_000);
  });

  it("turns a future by_date plan into by_contribution with a custom profile", () => {
    const patch = patchPhaseContributions(
      { planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045, phases },
      new Map([[0, 25_000]]),
      2026,
    );
    expect(patch).toMatchObject({
      planningMode: "by_contribution",
      phaseProfile: "custom",
      phases: [
        { fromMonth: 0, toMonth: 15, monthlyContribution: 25_000, label: "curto" },
        phases[1],
      ],
    });
  });

  it("leaves mode and profile alone on a by_contribution plan, including a guided one", () => {
    const patch = patchPhaseContributions(
      { planningMode: "by_contribution", phaseProfile: "constant", phases },
      new Map([[1, 4_000]]),
      2026,
    );
    expect(patch).toEqual({
      phases: [phases[0], { fromMonth: 15, toMonth: null, monthlyContribution: 4_000, label: "depois" }],
    });
    expect(patch?.planningMode).toBeUndefined();
    expect(patch?.phaseProfile).toBeUndefined();
  });

  it("returns null when no amount differs, including an empty map", () => {
    const goal = { planningMode: "by_date", phaseProfile: "front_loaded", targetYear: 2045, phases };
    expect(patchPhaseContributions(goal, new Map(), 2026)).toBeNull();
    expect(patchPhaseContributions(goal, new Map([[0, 15_000], [1, 8_000]]), 2026)).toBeNull();
  });

  it("updates amounts only when the target year is past, missing, or the current year", () => {
    const edited = new Map([[0, 25_000]]);
    for (const targetYear of [2020, null, undefined, 2026] as const) {
      const patch = patchPhaseContributions(
        { planningMode: "by_date", phaseProfile: "constant", targetYear, phases },
        edited,
        2026,
      );
      expect(patch?.planningMode).toBeUndefined();
      expect(patch?.phaseProfile).toBeUndefined();
      expect(patch?.phases[0].monthlyContribution).toBe(25_000);
      expect(patch?.phases[1]).toEqual(phases[1]);
    }
  });

  it("rejects an index outside the schedule and a negative amount", () => {
    const goal = { planningMode: "by_contribution", phaseProfile: "custom", phases };
    expect(() => patchPhaseContributions(goal, new Map([[2, 1]]))).toThrow(/outside 0–1/);
    expect(() => patchPhaseContributions(goal, new Map([[0, -1]]))).toThrow(/non-negative/);
  });
});

describe("fireGoalDialogBody", () => {
  const fmt = createFormatter({ numberFormat: "pt-BR", locale: "pt-BR" });
  const money = (value: number) => fmt.number(value, { min: 0, max: 2 });
  const goal = {
    planningMode: "by_date" as const,
    phaseProfile: "front_loaded",
    targetYear: 2045,
    phases,
  };
  const solved: ContributionPhase[] = [
    { ...phases[0], monthlyContribution: 22_000.456 },
    { ...phases[1], monthlyContribution: 11_000.2 },
  ];

  it("prefills a future by_date plan from the solved amounts", () => {
    expect(phasesShownForContributionEdit(goal, solved, 2026).map((phase) => phase.monthlyContribution)).toEqual([
      22_000.456, 11_000.2,
    ]);
    expect(phasesShownForContributionEdit(goal, solved, 2026)[0].label).toBe("curto");
    expect(phasesShownForContributionEdit({ ...goal, targetYear: 2020 }, solved, 2026)[0].monthlyContribution).toBe(15_000);
    expect(phasesShownForContributionEdit({ ...goal, targetYear: null }, solved, 2026)[1].monthlyContribution).toBe(8_000);
  });

  it("saving only income and return leaves mode, profile and phases out of the body", () => {
    const shown = phasesShownForContributionEdit(goal, solved, 2026);
    const baselineTexts = shown.map((phase) => money(phase.monthlyContribution));
    const body = fireGoalDialogBody({
      fields: { targetMonthlyIncome: 18_000, nominalAnnualReturn: 0.08 },
      goal,
      solvedPhases: solved,
      texts: baselineTexts,
      baselineTexts,
      parseNumber: (text) => fmt.parseNumber(text),
      nowYear: 2026,
    });
    expect(body).toEqual({ targetMonthlyIncome: 18_000, nominalAnnualReturn: 0.08 });
    expect(body).not.toHaveProperty("phases");
    expect(body).not.toHaveProperty("planningMode");
    expect(body).not.toHaveProperty("phaseProfile");
  });

  it("an edited phase switches a future by_date plan and keeps the other solved amount", () => {
    const shown = phasesShownForContributionEdit(goal, solved, 2026);
    const baselineTexts = shown.map((phase) => money(phase.monthlyContribution));
    const body = fireGoalDialogBody({
      fields: { nominalAnnualReturn: 0.1 },
      goal,
      solvedPhases: solved,
      texts: [money(25_000), baselineTexts[1]],
      baselineTexts,
      parseNumber: (text) => fmt.parseNumber(text),
      nowYear: 2026,
    });
    expect(body).toMatchObject({
      nominalAnnualReturn: 0.1,
      planningMode: "by_contribution",
      phaseProfile: "custom",
    });
    const written = body.phases as ContributionPhase[];
    expect(written[0].monthlyContribution).toBe(25_000);
    expect(written[0].label).toBe("curto");
    // The untouched phase keeps the solved amount, not the stale stored 8_000.
    expect(written[1].monthlyContribution).toBe(11_000.2);
    expect(written[1]).not.toMatchObject({ monthlyContribution: 8_000 });
  });

  it("a past target year updates the edited amount and does not switch", () => {
    const past = { ...goal, targetYear: 2020, phaseProfile: "constant" };
    const baselineTexts = past.phases.map((phase) => money(phase.monthlyContribution));
    const body = fireGoalDialogBody({
      fields: { annualInflation: 0.03 },
      goal: past,
      solvedPhases: solved,
      texts: [money(25_000), baselineTexts[1]],
      baselineTexts,
      parseNumber: (text) => fmt.parseNumber(text),
      nowYear: 2026,
    });
    expect(body.planningMode).toBeUndefined();
    expect(body.phaseProfile).toBeUndefined();
    expect(body.phases).toEqual([
      { ...phases[0], monthlyContribution: 25_000 },
      phases[1],
    ]);
  });

  it("does not save a blank phase field as 0", () => {
    expect(fmt.parseNumber("")).toBeNaN();
    expect(parseContributionText("", (text) => fmt.parseNumber(text))).toBeNull();
    expect(parseContributionText("   ", (text) => fmt.parseNumber(text))).toBeNull();
    expect(parseContributionText("0", (text) => fmt.parseNumber(text))).toBe(0);

    const shown = phasesShownForContributionEdit(goal, solved, 2026);
    const baselineTexts = shown.map((phase) => money(phase.monthlyContribution));
    const blank = fireGoalDialogBody({
      fields: { targetMonthlyIncome: 18_000 },
      goal,
      solvedPhases: solved,
      texts: ["", baselineTexts[1]],
      baselineTexts,
      parseNumber: (text) => fmt.parseNumber(text),
      nowYear: 2026,
    });
    expect(blank).toEqual({ targetMonthlyIncome: 18_000 });
    expect(JSON.stringify(blank)).not.toContain("monthlyContribution");

    const created = fireGoalDialogBody({
      fields: { targetMonthlyIncome: 18_000 },
      goal: null,
      texts: [""],
      baselineTexts: [],
      parseNumber: (text) => fmt.parseNumber(text),
      currency: "BRL",
      nowYear: 2026,
    });
    expect(created).toEqual({ targetMonthlyIncome: 18_000 });
    expect(created.phases).toBeUndefined();

    const zero = fireGoalDialogBody({
      fields: {},
      goal: { planningMode: "by_contribution", phaseProfile: "constant", phases },
      texts: [money(0), money(phases[1].monthlyContribution)],
      baselineTexts: phases.map((phase) => money(phase.monthlyContribution)),
      parseNumber: (text) => fmt.parseNumber(text),
      nowYear: 2026,
    });
    expect((zero.phases as ContributionPhase[])[0].monthlyContribution).toBe(0);
    expect(zero.phaseProfile).toBeUndefined();
  });
});
