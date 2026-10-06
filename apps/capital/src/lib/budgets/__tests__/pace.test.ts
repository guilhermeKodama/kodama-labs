import { describe, expect, it } from "vitest";
import { monthPace, paceTone, percent, projectionVsBudget, STATUS_KEY, toneOf, usage, yearlyTone } from "../pace";

describe("monthPace", () => {
  it("marks today only while the month runs", () => {
    // Mockup: day 22 of 30.
    expect(monthPace({ daysElapsed: 22, daysInMonth: 30, isCurrent: true })).toBeCloseTo(22 / 30);
    expect(monthPace({ daysElapsed: 30, daysInMonth: 30, isCurrent: false })).toBeNull();
    expect(monthPace({ daysElapsed: 0, daysInMonth: 31, isCurrent: false })).toBeNull();
  });
});

describe("tones", () => {
  const pace = 22 / 30;

  it("matches the mockup's BUDGETS rows", () => {
    // Restaurantes 912/800: Estourado; Saúde 1792/1800 (99.6%, pace 73% + 12): Acima do ritmo; Mercado 1640/2000: No ritmo.
    expect(toneOf(usage(912, 800), pace)).toBe("over");
    expect(toneOf(usage(1792, 1800), pace)).toBe("ahead");
    expect(toneOf(usage(1640, 2000), pace)).toBe("normal");
    // A closed month has no pace: only "passed" colors a bar.
    expect(toneOf(0.99, null)).toBe("normal");
  });

  it("maps the server's status", () => {
    expect(paceTone("over")).toBe("over");
    expect(paceTone("ahead_of_pace")).toBe("ahead");
    expect(paceTone("on_track")).toBe("normal");
    expect(STATUS_KEY[paceTone("ahead_of_pace")]).toBe("ahead");
  });

  it("turns yearly budgets yellow above 90%", () => {
    expect(yearlyTone(6650 / 6800)).toBe("warn");
    expect(yearlyTone(14200 / 25000)).toBe("normal");
  });

  it("rounds percents and guards a zero budget", () => {
    expect(percent(usage(1640, 2000))).toBe(82);
    expect(usage(100, 0)).toBe(0);
  });
});

describe("projectionVsBudget", () => {
  it("says how far above or how much slack", () => {
    expect(projectionVsBudget(17500, 16800)).toEqual({ kind: "over", amount: 700 });
    expect(projectionVsBudget(16000, 16800)).toEqual({ kind: "slack", amount: 800 });
    expect(projectionVsBudget(100, 0)).toBeNull();
  });
});
