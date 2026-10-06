import { describe, expect, it } from "vitest";
import { applyViewDraft } from "@/lib/ledger/view-draft";
import { planViewUpdate } from "@/lib/ledger/view-update";
import { viewConfig } from "./fixtures";

const outflows = [{ field: "flowKind" as const, op: "in" as const, values: ["out"] }];

describe("where a view change goes", () => {
  it("saves a user view at once", () => {
    const saved = viewConfig();
    const plan = planViewUpdate({ saved, draft: null, isBuiltin: false, patch: { filters: outflows } });
    expect(plan.draft).toBeNull();
    expect(plan.save).toEqual({ ...saved, filters: outflows });
  });

  it("keeps filters on Todas in the draft and saves its display preferences", () => {
    const saved = viewConfig();
    const filtered = planViewUpdate({ saved, draft: null, isBuiltin: true, patch: { filters: outflows } });
    expect(filtered).toEqual({ save: null, draft: { filters: outflows } });
    const grouped = planViewUpdate({ saved, draft: filtered.draft, isBuiltin: true, patch: { groupBy: [{ field: "categoryId" }] } });
    expect(grouped.save).toEqual({ ...saved, groupBy: [{ field: "categoryId" }] });
    expect(grouped.draft).toEqual({ filters: outflows });
  });

  it("drops Todas' draft once its filters are gone", () => {
    const saved = viewConfig();
    expect(planViewUpdate({ saved, draft: { filters: outflows }, isBuiltin: true, patch: { filters: [] } }).draft).toBeNull();
  });

  it("keeps a drill's banner and its way back while the drilled table changes", () => {
    const saved = viewConfig({ layout: "pivot" });
    const back = { filters: [{ field: "entityId" as const, op: "in" as const, values: ["e1"] }] };
    const draft = { layout: "table" as const, filters: outflows, label: "Saídas · set/2026", back };
    const sorted = planViewUpdate({ saved, draft, isBuiltin: false, patch: { sort: [{ field: "absAmountBase", dir: "desc" }] } });
    expect(sorted.draft).toMatchObject({ label: "Saídas · set/2026", back, sort: [{ field: "absAmountBase", dir: "desc" }] });
    // On Todas too, while something is left in the draft.
    const todas = planViewUpdate({ saved, draft, isBuiltin: true, patch: { filters: [...outflows, { field: "categoryId", op: "in", values: ["c1"] }] } });
    expect(todas.draft).toMatchObject({ label: "Saídas · set/2026", back });
    // Back to the saved config: no draft, no banner.
    expect(planViewUpdate({ saved, draft, isBuiltin: false, patch: { layout: "pivot", filters: [] } }).draft).toBeNull();
    // A draft that is not a drill gets no banner.
    expect(planViewUpdate({ saved, draft: { layout: "table" }, isBuiltin: false, patch: { filters: outflows } }).draft).not.toHaveProperty("label");
  });

  it("keeps changes in the draft while a view shows a drill, and saves nothing", () => {
    const saved = viewConfig({ layout: "pivot" });
    const draft = { layout: "table" as const, filters: outflows };
    const plan = planViewUpdate({ saved, draft, isBuiltin: false, patch: { sort: [{ field: "absAmountBase", dir: "desc" }] } });
    expect(plan.save).toBeNull();
    expect(applyViewDraft(saved, plan.draft)).toEqual({ ...saved, layout: "table", filters: outflows, sort: [{ field: "absAmountBase", dir: "desc" }] });
  });

  it("on Todas a drill keeps its table while the saved layout changes underneath", () => {
    const saved = viewConfig({ layout: "pivot" });
    const plan = planViewUpdate({ saved, draft: { layout: "table", filters: outflows }, isBuiltin: true, patch: { period: { preset: "last_3m", offset: 0 } } });
    expect(plan.save).toEqual({ ...saved, period: { preset: "last_3m", offset: 0 } });
    expect(plan.draft).toEqual({ layout: "table", filters: outflows });
  });
});
