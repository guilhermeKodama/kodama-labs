import { describe, expect, it } from "vitest";
import { layoutTreemap, showsTreemapLabel, treemapShade, TREEMAP_H, TREEMAP_W } from "@/lib/ledger/treemap";
import { waterfallBar, waterfallScale, waterfallSteps } from "@/lib/ledger/waterfall";

describe("treemap", () => {
  it("tiles the whole box with positive values only, largest first", () => {
    const rects = layoutTreemap([
      { value: 50, data: "a" },
      { value: 30, data: "b" },
      { value: 20, data: "c" },
      { value: 0, data: "zero" },
      { value: -5, data: "neg" },
    ]);
    expect(rects.map((r) => r.data)).toEqual(["a", "b", "c"]);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(TREEMAP_W * TREEMAP_H);
    // Each tile's area is its share.
    expect((rects[0].w * rects[0].h) / area).toBeCloseTo(0.5);
    expect(rects.map((r) => r.rank)).toEqual([0, 1, 2]);
  });

  it("shades by rank and labels large tiles", () => {
    expect([0, 1, 2, 3, 4, 9].map(treemapShade)).toEqual([1, 2, 3, 3, 4, 4]);
    expect(showsTreemapLabel({ w: 30, h: 21 })).toBe(true);
    expect(showsTreemapLabel({ w: 20, h: 30 })).toBe(false);
  });
});

describe("waterfall", () => {
  it("puts incomes first (largest first), then expenses (most negative first), then Resultado", () => {
    const steps = waterfallSteps([
      { value: -300, data: "mercado" },
      { value: 1000, data: "receita" },
      { value: -500, data: "aluguel" },
      { value: 200, data: "rendimento" },
    ]);
    expect(steps.map((s) => s.data)).toEqual(["receita", "rendimento", "aluguel", "mercado", null]);
    expect(steps.map((s) => [s.start, s.end])).toEqual([
      [0, 1000],
      [1000, 1200],
      [1200, 700],
      [700, 400],
      [0, 400],
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["pos", "pos", "neg", "neg", "total"]);
  });

  it("scales with zero inside the range and bars of at least 2px", () => {
    const steps = waterfallSteps([{ value: 100, data: "a" }, { value: -300, data: "b" }]);
    const y = waterfallScale(steps, 240);
    expect(y(100)).toBe(0);
    expect(y(-200)).toBe(240);
    expect(waterfallBar(steps[2], y)).toEqual({ top: y(0), height: 240 - y(0) });
    expect(waterfallBar({ data: null, value: 0, start: 0, end: 0, kind: "total" }, y).height).toBe(2);
  });
});
