import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RingBar, TrunkBadge, TrunkFigure } from "@/components/invest/fire/trunk";
import { buildTrunk, projectedRings, ringHistory, type HistoryPoint } from "@/lib/invest/fire-rings";

const NOW = new Date(2026, 9, 20);
const month = (period: string, netWorth: number, contributed: number): HistoryPoint => ({ period, netWorth, contributed, estimated: false });

const history = ringHistory(
  [month("2020-12", 3_000, 3_000), month("2021-12", 3_600, 3_400), month("2022-12", 3_500, 3_800), month("2025-12", 5_000, 4_600), month("2026-10", 5_400, 5_000)],
  5_600,
  NOW,
);
const future = projectedRings(
  [
    { monthIndex: 0, investedValue: 5_600, contributionsToDate: 5_600, growthToDate: 0 },
    { monthIndex: 120, investedValue: 12_000, contributionsToDate: 10_000, growthToDate: 2_000 },
  ],
  NOW,
  10_000,
  true,
);
const trunk = buildTrunk(history, future, 10_000, 2034);
const text = { label: "Corte do tronco", core: "cerne", coreValue: "R$ 3 mil · 2020", now: "hoje", goal: "liberdade financeira · R$ 10 mil" };

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("TrunkFigure", () => {
  const html = render(createElement(TrunkFigure, { trunk, marks: [{ id: "m", r: 200, label: "R$ 6 mil" }], text }));

  it("is one labelled image", () => {
    expect(html.match(/<svg[^>]*role="img"[^>]*aria-label="Corte do tronco"/)).not.toBeNull();
  });

  it("draws the core, a filled disc per past ring, the arc of this year and the projected rings dashed", () => {
    expect(trunk.past.map((ring) => ring.year)).toEqual([2021, 2022, 2025]);
    // Wood discs (past rings) take the alternating wood fills.
    expect(html.match(/fill="var\(--cap-trunk-wood-[ab]\)"/g)).toHaveLength(trunk.past.length);
    expect(html).toContain(`<path d="${trunk.current!.path}" fill="var(--cap-resin)"`);
    expect(html).toContain('stroke-dasharray="3 5"');
    expect(html).toContain('stroke-dasharray="7 6"');
    expect(html).toContain('fill="var(--cap-trunk-heart)"');
  });

  it("writes the core, today, the goal, the years and the milestone in theme type roles", () => {
    for (const s of ["cerne", "R$ 3 mil · 2020", "hoje", "liberdade financeira · R$ 10 mil", "2034", "R$ 6 mil"]) expect(html).toContain(`>${s}</text>`);
    expect(html).toContain("font-size:var(--cap-font-label)");
    expect(html).not.toMatch(/font-size:\s*\d/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe("TrunkBadge and RingBar", () => {
  it("puts the progress in the core of the small trunk", () => {
    const html = render(createElement(TrunkBadge, { trunk, label: "56% da meta", center: "56%", className: "size-[168px]" }));
    expect(html).toContain('aria-label="56% da meta"');
    expect(html).toContain('stroke-dasharray="18 14"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>56%<\/span>/);
  });

  it("splits a ring into aportes and rendimento, and shows a loss in the negative color", () => {
    const gain = render(createElement(RingBar, { aportes: 75, rendimento: 25 }));
    expect(gain).toContain('class="bg-trunk-aportes" style="width:75%"');
    expect(gain).toContain('class="bg-pos" style="width:25%"');
    const loss = render(createElement(RingBar, { aportes: 50, rendimento: -50 }));
    expect(loss).toContain('class="bg-neg" style="width:50%"');
  });
});
