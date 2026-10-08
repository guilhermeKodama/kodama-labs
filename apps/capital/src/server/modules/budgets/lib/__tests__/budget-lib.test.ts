import { describe, expect, it } from "vitest";
import { budgetFor, excludedEntities, mean, stillToCome, suggestedBudget, typical } from "../assign";
import { resolveEffective } from "../effective-budgets";
import { todayIn } from "../today";

const month = (ym: string, hour = 12) => new Date(`${ym}-01T${String(hour).padStart(2, "0")}:00:00.000Z`);
const v = (id: string, from: string, extra: Partial<{ entityId: string | null; categoryId: string; period: "monthly" | "yearly"; isTombstone: boolean }> = {}) => ({
  id,
  entityId: null as string | null,
  categoryId: "food",
  period: "monthly" as const,
  isTombstone: false,
  effectiveFrom: month(from),
  ...extra,
});

describe("resolveEffective", () => {
  it("takes the latest version per chain up to the month", () => {
    const rows = [v("jan", "2026-01"), v("sep", "2026-09"), v("pf", "2026-03", { entityId: "pf" }), v("year", "2026-01", { period: "yearly" })];
    expect(resolveEffective(rows, month("2026-08")).map((b) => b.id).sort()).toEqual(["jan", "pf", "year"]);
    expect(resolveEffective(rows, month("2026-09")).map((b) => b.id).sort()).toEqual(["pf", "sep", "year"]);
    expect(resolveEffective(rows, month("2025-12"))).toEqual([]);
  });

  it("ends a chain at a tombstone instead of bringing an older version back", () => {
    const rows = [v("jan", "2026-01"), v("end", "2026-06", { isTombstone: true }), v("again", "2026-10")];
    expect(resolveEffective(rows, month("2026-05")).map((b) => b.id)).toEqual(["jan"]);
    expect(resolveEffective(rows, month("2026-06"))).toEqual([]);
    expect(resolveEffective(rows, month("2026-09"))).toEqual([]);
    expect(resolveEffective(rows, month("2026-10")).map((b) => b.id)).toEqual(["again"]);
  });

  it("compares by year-month, so a legacy midnight version resolves like a noon one", () => {
    const rows = [{ ...v("legacy", "2026-01"), effectiveFrom: month("2026-03", 0) }];
    expect(resolveEffective(rows, month("2026-03")).map((b) => b.id)).toEqual(["legacy"]);
  });
});

describe("budgetFor / excludedEntities", () => {
  const budgets = [
    { id: "all-soft", entityId: null, categoryId: "soft" },
    { id: "pj-soft", entityId: "pj", categoryId: "soft" },
    { id: "pf-food", entityId: "pf", categoryId: "food" },
  ];

  it("gives spend to the entity's own budget, else to the one for every entity", () => {
    expect(budgetFor(budgets, "pj", "soft")?.id).toBe("pj-soft");
    expect(budgetFor(budgets, "pf", "soft")?.id).toBe("all-soft");
    expect(budgetFor(budgets, "pf", "food")?.id).toBe("pf-food");
    expect(budgetFor(budgets, "pj", "food")).toBeUndefined();
    expect(budgetFor(budgets, "pf", null)).toBeUndefined();
  });

  it("lists the entities a budget for every entity does not count", () => {
    expect(excludedEntities(budgets, budgets[0])).toEqual(["pj"]);
    expect(excludedEntities(budgets, budgets[1])).toEqual([]);
  });
});

describe("helpers", () => {
  it("rounds suggestions up to the next 50", () => {
    expect(suggestedBudget(1990)).toBe(2000);
    expect(suggestedBudget(2000)).toBe(2000);
    expect(suggestedBudget(851.2)).toBe(900);
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("takes a median, and the smaller of two months even when both are legitimate", () => {
    expect(typical([])).toBe(0);
    expect(typical([150000])).toBe(150000);
    // 6_000 and 8_000 are both real spend. The mean would be 7_000; two months
    // cannot separate that from a one-off, so the forecast stays at 6_000.
    expect(typical([6000, 8000])).toBe(6000);
    expect(typical([8000, 6000])).toBe(6000);
    expect(typical([2000, 2000, 150000])).toBe(2000);
    expect(typical([2000, 2000, 2000, 2000, 2000, 150000])).toBe(2000);
    expect(typical([1780, 1990, 2080, 2100, 2240, 2310])).toBe(2090);
  });

  it("does not forecast a variable-day bill again once it has been paid", () => {
    // 15,000 on the 20th in four months and on the 3rd in two. Already paid.
    const totals = [15000, 15000, 15000, 15000, 15000, 15000];
    const tails = [15000, 15000, 15000, 15000, 0, 0];
    expect(stillToCome(totals, tails, 15000)).toBe(0);
  });

  it("keeps a stable post-today tail when this month is already ahead of any historical early spend", () => {
    // Card: 100 by today and 900 after, every month. 400 is already spent.
    expect(stillToCome([1000, 1000, 1000], [900, 900, 900], 400)).toBe(900);
  });

  it("keeps the usual remainder when spent-to-date matches the historical early amount", () => {
    // Groceries: 600 by today and 600 after. 600 is already spent.
    expect(stillToCome([1200, 1200, 1200], [600, 600, 600], 600)).toBe(600);
  });

  it("reads today in the user's timezone", () => {
    const t = todayIn("America/Sao_Paulo", new Date("2026-10-01T02:00:00Z"));
    expect([t.iso, t.d]).toEqual(["2026-09-30", 30]);
    expect(t.end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(todayIn("UTC", new Date("2026-10-01T02:00:00Z")).iso).toBe("2026-10-01");
  });
});
