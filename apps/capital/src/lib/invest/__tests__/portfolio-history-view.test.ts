import { describe, expect, it } from "vitest";
import { netWorthChartRows, netWorthTooltipRows } from "../portfolio-history-view";

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

describe("netWorthTooltipRows", () => {
  it("follows stack order and names capital investido when aportes are negative", () => {
    // out/26, in R$ mil: the aportes stroke sits at 839.5 + (−151.3) = 688.2, under the dashed line.
    expect(netWorthTooltipRows({ netWorth: 1115.3, aportes: -151.3, initial: 839.5 }, true)).toEqual([
      { key: "initial", value: 839.5, derived: false },
      { key: "aportes", value: -151.3, derived: false },
      { key: "netWorth", value: 1115.3, derived: false },
      { key: "capitalInvested", value: 688.2, derived: true },
    ]);
    expect(netWorthTooltipRows({ netWorth: 862.8, aportes: -176.7, initial: 839.5 }, true).at(-1)).toEqual({
      key: "capitalInvested",
      value: 662.8,
      derived: true,
    });
  });

  it("omits the opening book and the derived total when that series is hidden", () => {
    expect(netWorthTooltipRows({ netWorth: 10, aportes: 8, initial: 0 }, false)).toEqual([
      { key: "aportes", value: 8, derived: false },
      { key: "netWorth", value: 10, derived: false },
    ]);
  });
});
