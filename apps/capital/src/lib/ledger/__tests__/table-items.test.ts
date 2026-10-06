import { describe, expect, it } from "vitest";
import { groupItemId, tableItems, visualRowIds } from "@/lib/ledger/table-items";
import { group } from "./fixtures";

const row = (id: string, ...groupKeys: (string | null)[]) => ({ id, groupKeys });

describe("table lines", () => {
  const rows = [row("r1", "pf", "mercado"), row("r2", "pf", "mercado"), row("r3", "pf", null), row("r4", "pj→pf", null)];
  const groups = [group("pf", -300, 3, [group("mercado", -200, 2), group(null, -100, 1)]), group("pj→pf", 0, 1, [group(null, 0, 1)])];
  const keys = [{ field: "entityId" as const }, { field: "categoryId" as const }];

  it("lists rows as they are without grouping", () => {
    expect(tableItems(rows, [], [], new Set()).map((i) => i.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("puts a header before each group and subgroup, with the server's group", () => {
    const items = tableItems(rows, groups, keys, new Set());
    expect(items.map((i) => i.id)).toEqual(["g/pf", "g/pf/mercado", "r1", "r2", "g/pf/∅", "r3", "g/pj→pf", "g/pj→pf/∅", "r4"]);
    const header = items[0];
    expect(header.type === "group" && header.group?.count).toBe(3);
    const sub = items[4];
    expect(sub.type === "group" && sub.group?.values["sum:amountBase"]).toBe(-100);
  });

  it("hides the rows and subgroups of a collapsed group", () => {
    const items = tableItems(rows, groups, keys, new Set([groupItemId(["pf"]), groupItemId(["pj→pf", null])]));
    expect(items.map((i) => i.id)).toEqual(["g/pf", "g/pj→pf", "g/pj→pf/∅"]);
    expect(visualRowIds(items)).toEqual([]);
    expect(visualRowIds(tableItems(rows, groups, keys, new Set([groupItemId(["pf", "mercado"])])))).toEqual(["r3", "r4"]);
  });
});
