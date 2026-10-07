import { describe, expect, it } from "vitest";
import { netWorthChartRows } from "../portfolio-history-view";

describe("netWorthChartRows", () => {
  it("splits Total aportado into aportes and posições iniciais (stacked, the top is still the total)", () => {
    const { rows, hasInitial } = netWorthChartRows([
      { period: "2026-08", netWorth: 10000, contributed: 10000, initialPositions: 0 },
      // 50k of positions typed in during September: no aporte jump, a posição inicial.
      { period: "2026-09", netWorth: 61000, contributed: 60000, initialPositions: 50000 },
      { period: "2026-10", netWorth: 64000, contributed: 62000, initialPositions: 50000 },
    ]);
    expect(hasInitial).toBe(true);
    expect(rows.map((r) => [r.period, r.aportes, r.initial])).toEqual([
      ["2026-08", 10000, 0],
      ["2026-09", 10000, 50000],
      ["2026-10", 12000, 50000],
    ]);
    for (const [i, r] of rows.entries()) expect(r.aportes + r.initial).toBe([10000, 60000, 62000][i]);
  });

  it("has no posições iniciais series when every holding came with operations", () => {
    expect(netWorthChartRows([{ period: "2026-09", netWorth: 1, contributed: 1, initialPositions: 0 }]).hasInitial).toBe(false);
  });
});
