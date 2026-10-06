import { describe, expect, it } from "vitest";
import { budgetDrill, budgetDrillFilters, budgetsDrill, budgetsDrillFilters, monthPeriod, monthsPeriod, ruleEntriesDraft } from "../drill";

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

describe("budgetsDrillFilters (KPIs and Total rows)", () => {
  it("selects the budgeted categories of entity budgets, by their entities", () => {
    const rows = [
      { entityId: "pf", categoryId: "mercado" },
      { entityId: "pf", categoryId: "moradia" },
      { entityId: "ltda", categoryId: "impostos" },
    ];
    expect(budgetsDrillFilters(rows, null)).toEqual([
      ...base,
      { field: "categoryId", op: "in", values: ["mercado", "moradia", "impostos"] },
      { field: "entityId", op: "in", values: ["pf", "ltda"] },
    ]);
  });

  it("covers every scoped entity when a category has a budget for every entity", () => {
    const rows = [
      { entityId: null, categoryId: "software", excludeEntityIds: [] },
      { entityId: "pf", categoryId: "mercado" },
    ];
    expect(budgetsDrillFilters(rows, null)).toEqual([...base, { field: "categoryId", op: "in", values: ["software", "mercado"] }]);
    expect(budgetsDrillFilters(rows, ["ltda", "llc"])).toContainEqual({ field: "entityId", op: "in", values: ["ltda", "llc"] });
  });

  it("has no drill without rows", () => {
    expect(budgetsDrillFilters([], null)).toBeNull();
    expect(budgetsDrill([], null, monthPeriod(2026, 9))).toBeNull();
  });

  it("drills on the effective date over the period", () => {
    expect(budgetsDrill([{ entityId: "pf", categoryId: "c" }], ["pf"], monthPeriod(2026, 9, 22))).toMatchObject({
      dateField: "effectiveDate",
      period: { from: "2026-09-01", to: "2026-09-22" },
    });
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

describe("ruleEntriesDraft", () => {
  const rule = { id: "rule-1", description: "Aluguel" };

  it("drills to every entry the rule booked, labelled with its description", () => {
    expect(ruleEntriesDraft(rule)).toEqual({
      label: "Aluguel",
      filters: [{ field: "recurringRuleId", op: "in", values: ["rule-1"] }],
      period: { preset: "all", offset: 0 },
    });
  });
});
