import { describe, expect, it } from "vitest";
import { createFormatter } from "@/lib/format";
import { frequencyOptions, groupRules, ruleForm, rulePatch } from "../rule-form";

const fmt = createFormatter();
const rule = { amount: 4200, frequency: "monthly", autoGenerate: false, nextDueDate: "2026-10-05", endDate: null, isActive: true };
const format = (v: number) => fmt.number(v, { min: 0, max: 2 });

describe("rule form", () => {
  it("starts from the rule, in the user's number format", () => {
    expect(ruleForm(rule, format)).toEqual({ amount: "4.200", frequency: "monthly", autoGenerate: false, nextDueDate: "2026-10-05", endDate: "", isActive: true });
  });

  it("sends nothing when nothing changed", () => {
    expect(rulePatch(ruleForm(rule, format), rule, fmt.parseNumber)).toEqual({ patch: {}, errors: new Set() });
  });

  it("sends only the changed fields", () => {
    const form = { ...ruleForm(rule, format), amount: "4.350,50", autoGenerate: true, endDate: "2026-12-31", isActive: false };
    expect(rulePatch(form, rule, fmt.parseNumber).patch).toEqual({ amount: 4350.5, autoGenerate: true, endDate: "2026-12-31", isActive: false });
  });

  it("clears the end date with null", () => {
    const ending = { ...rule, endDate: "2026-12-31" };
    expect(rulePatch({ ...ruleForm(ending, format), endDate: "" }, ending, fmt.parseNumber).patch).toEqual({ endDate: null });
  });

  it("flags a missing amount and malformed dates", () => {
    const { errors } = rulePatch({ ...ruleForm(rule, format), amount: "0", nextDueDate: "05/10", endDate: "2026-02-31x" }, rule, fmt.parseNumber);
    expect([...errors].sort()).toEqual(["amount", "endDate", "nextDueDate"]);
  });

  it("offers the mockup's frequencies, plus daily for a daily rule", () => {
    expect(frequencyOptions("monthly")).toEqual(["weekly", "monthly", "yearly"]);
    expect(frequencyOptions("daily")).toContain("daily");
  });

  it("lists active rules by due date, then paused ones", () => {
    const rules = [
      { id: "a", isActive: true, nextDueDate: "2026-10-12", description: "Fatura" },
      { id: "b", isActive: false, nextDueDate: "2026-09-01", description: "Academia" },
      { id: "c", isActive: true, nextDueDate: "2026-10-05", description: "Aluguel" },
    ];
    const grouped = groupRules(rules);
    expect(grouped.active.map((r) => r.id)).toEqual(["c", "a"]);
    expect(grouped.paused.map((r) => r.id)).toEqual(["b"]);
  });
});
