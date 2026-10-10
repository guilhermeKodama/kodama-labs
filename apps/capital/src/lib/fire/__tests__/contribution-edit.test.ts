import { describe, expect, it } from "vitest";
import { currentPhaseIndex, patchPhaseContributions, phaseMonthRange } from "../contribution-edit";
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

  it("turns a by_date plan into by_contribution with a custom profile", () => {
    const patch = patchPhaseContributions(
      { planningMode: "by_date", phaseProfile: "front_loaded", phases },
      new Map([[0, 25_000]]),
    );
    expect(patch.planningMode).toBe("by_contribution");
    expect(patch.phaseProfile).toBe("custom");
    expect(patch.phases[1]).toEqual(phases[1]);
  });

  it("turns a guided by_contribution profile custom without changing the mode", () => {
    const patch = patchPhaseContributions(
      { planningMode: "by_contribution", phaseProfile: "constant", phases },
      new Map([[1, 4_000]]),
    );
    expect(patch.planningMode).toBeUndefined();
    expect(patch.phaseProfile).toBe("custom");
    expect(patch.phases[0]).toEqual(phases[0]);
    expect(patch.phases[1].monthlyContribution).toBe(4_000);
  });

  it("rejects an index outside the schedule and a negative amount", () => {
    const goal = { planningMode: "by_contribution", phaseProfile: "custom", phases };
    expect(() => patchPhaseContributions(goal, new Map([[2, 1]]))).toThrow(/outside 0–1/);
    expect(() => patchPhaseContributions(goal, new Map([[0, -1]]))).toThrow(/non-negative/);
  });
});
