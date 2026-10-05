import { describe, expect, it } from "vitest";
import { budgetDrill, budgetDrillFilters, monthPeriod, monthsPeriod } from "../drill";

const base = [
  { field: "kind", op: "in", values: ["expense"] },
  { field: "transferDirection", op: "isNull" },
];

describe("budgetDrillFilters", () => {
  it("selects an entity's own budget by its entity, whatever the scope", () => {
    expect(budgetDrillFilters({ entityId: "pj", categoryId: "soft" }, null)).toEqual([
      ...base,
      { field: "categoryId", op: "in", values: ["soft"] },
      { field: "entityId", op: "in", values: ["pj"] },
    ]);
    expect(budgetDrillFilters({ entityId: "pj", categoryId: "soft" }, ["pf"])).toContainEqual({ field: "entityId", op: "in", values: ["pj"] });
  });

  it("leaves out, for a budget for every entity, the entities with their own budget", () => {
    expect(budgetDrillFilters({ entityId: null, categoryId: "soft", excludeEntityIds: ["pj"] }, null)).toContainEqual({ field: "entityId", op: "nin", values: ["pj"] });
    expect(budgetDrillFilters({ entityId: null, categoryId: "soft" }, null).some((f) => f.field === "entityId")).toBe(false);
  });

  it("keeps a budget for every entity inside the screen's scope", () => {
    expect(budgetDrillFilters({ entityId: null, categoryId: "soft", excludeEntityIds: ["pj2"] }, ["pj1", "pj2"])).toContainEqual({ field: "entityId", op: "in", values: ["pj1"] });
    // Every scoped entity has its own budget: the drill matches nothing rather than everything.
    expect(budgetDrillFilters({ entityId: null, categoryId: "soft", excludeEntityIds: ["pj"] }, ["pj"])).toContainEqual({ field: "entityId", op: "in", values: ["__none__"] });
  });

  it("drills to uncategorized spend with isNull", () => {
    expect(budgetDrillFilters({ entityId: "pf", categoryId: null }, null)).toContainEqual({ field: "categoryId", op: "isNull" });
  });
});

describe("periods", () => {
  it("bounds a month, optionally through a day", () => {
    expect(monthPeriod(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthPeriod(2026, 9, 22)).toEqual({ from: "2026-09-01", to: "2026-09-22" });
    expect(monthPeriod(2026, 9, 40)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthsPeriod(2026, 1, 9)).toEqual({ from: "2026-01-01", to: "2026-09-30" });
  });

  it("drills on the effective date", () => {
    expect(budgetDrill({ entityId: "pf", categoryId: "c" }, null, monthPeriod(2026, 9))).toMatchObject({ dateField: "effectiveDate", period: { from: "2026-09-01" } });
  });
});
