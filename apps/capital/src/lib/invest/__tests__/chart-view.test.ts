import { describe, expect, it } from "vitest";
import { buildChartData } from "@/lib/ledger/chart-data";
import { COUNT_KEY, SUM_KEY } from "@/lib/ledger/columns";
import {
  holdingsChartGroups,
  normalizeHoldingsChart,
  normalizeOpsChart,
  opsChartGroups,
  usesLegacyIncomeChart,
  withLayout,
} from "../chart-view";
import {
  buildHoldingsTable,
  DEFAULT_HOLDINGS_CONFIG,
  normalizeHoldingsConfig,
  type HoldingsViewConfig,
} from "../holdings-view";
import { INCOME_12M_CONFIG, normalizeOpsConfig } from "../ops-view";
import type { BrokerCash, Holding, Operation } from "../types";

const holding = (
  id: string,
  ticker: string,
  cls: Holding["allocationClass"],
  value: number,
  invested: number,
  accountId = "a1",
): Holding =>
  ({
    id,
    ticker,
    name: ticker,
    allocationClass: cls,
    accountId,
    accountName: accountId,
    entityId: "e1",
    marketValueBase: value,
    investedBase: invested,
    unrealizedGainPercent: invested ? (value - invested) / invested : null,
    isActive: true,
    currency: "BRL",
  }) as unknown as Holding;

const holdings = [
  holding("h1", "PETR4", "br_stocks", 600, 500),
  holding("h2", "VALE3", "br_stocks", 200, 300),
  holding("h3", "HGLG11", "fii", 150, 100, "a2"),
  holding("h4", "BTC", "crypto", 50, 40),
];
const brokers = [
  {
    accountId: "a1",
    name: "Corretora",
    entityId: "e1",
    cashBase: 100,
    currency: "BRL",
  } as unknown as BrokerCash,
];
const config = (patch: Partial<HoldingsViewConfig>): HoldingsViewConfig => ({
  ...DEFAULT_HOLDINGS_CONFIG,
  ...patch,
});
const rate = () => 1;

describe("holdingsChartGroups", () => {
  it("charts the groups of the view by market value", () => {
    const table = buildHoldingsTable(
      holdings,
      brokers,
      config({ groupBy: "allocationClass" }),
    );
    const { groups, buildMetric, unit } = holdingsChartGroups(
      table,
      "allocationClass",
      "marketValue",
    );
    expect(buildMetric).toBe("sum");
    expect(unit).toBe("money");
    expect(groups.map((g) => [g.key, g.values[SUM_KEY]])).toEqual([
      ["br_stocks", 800],
      ["fii", 150],
      ["cash", 100],
      ["crypto", 50],
    ]);
  });

  it("charts each asset when ungrouped, cash as one category", () => {
    const table = buildHoldingsTable(
      holdings,
      brokers,
      config({ groupBy: "none" }),
    );
    const { groups, rows } = holdingsChartGroups(table, "none", "marketValue");
    expect(groups).toHaveLength(5);
    expect(rows.get("h1")?.ticker).toBe("PETR4");
    expect([...rows.values()].filter((r) => r.kind === "cash")).toHaveLength(1);
  });

  it("uses the share of the portfolio and the signed result in money", () => {
    const table = buildHoldingsTable(
      holdings,
      brokers,
      config({ groupBy: "none" }),
    );
    const share = holdingsChartGroups(table, "none", "share");
    expect(share.unit).toBe("pct");
    expect(
      share.groups.reduce((s, g) => s + (g.values[COUNT_KEY] ?? 0), 0),
    ).toBeCloseTo(1, 6);
    const result = holdingsChartGroups(table, "none", "result");
    const data = buildChartData(result.groups, {
      type: "bar",
      metric: result.buildMetric,
      cumulative: false,
      top: 0,
      hasSeries: false,
    });
    const byKey = new Map(
      data.categories.map((c, i) => [c.key, data.series[0].values[i]]),
    );
    expect(byKey.get("h1")).toBe(100);
    expect(byKey.get("h2")).toBe(-100);
  });

  it("folds the tail into Outros with Top N", () => {
    const table = buildHoldingsTable(
      holdings,
      brokers,
      config({ groupBy: "none" }),
    );
    const { groups, buildMetric } = holdingsChartGroups(
      table,
      "none",
      "marketValue",
    );
    const data = buildChartData(groups, {
      type: "bar",
      metric: buildMetric,
      cumulative: false,
      top: 2,
      hasSeries: false,
    });
    expect(data.categories).toHaveLength(3);
    expect(data.categories[2].others).toHaveLength(3);
    expect(data.series[0].values).toEqual([600, 200, 300]);
  });
});

describe("ops chart", () => {
  const op = (
    id: string,
    date: string,
    type: Operation["type"],
    total: number,
    cls: Operation["allocationClass"],
  ): Operation =>
    ({
      id,
      date,
      type,
      totalAmount: total,
      taxWithheld: 0,
      currency: "BRL",
      allocationClass: cls,
    }) as unknown as Operation;
  const ops = [
    op("1", "2026-08-10", "dividend", 10, "br_stocks"),
    op("2", "2026-08-20", "yield_payment", 5, "fii"),
    op("3", "2026-10-01", "dividend", 7, "br_stocks"),
  ];
  const cfg = {
    ...INCOME_12M_CONFIG,
    period: { preset: "last_3m" as const, offset: 0 },
  };

  it("zero-fills the months of the period and sums per month", () => {
    const groups = opsChartGroups(ops, cfg, "2026-10-07", rate);
    expect(
      groups.map((g) => [g.key, g.values[SUM_KEY], g.values[COUNT_KEY]]),
    ).toEqual([
      ["2026-08", 15, 2],
      ["2026-09", 0, 0],
      ["2026-10", 7, 1],
    ]);
  });

  it("groups by type and by class, with the class as series", () => {
    const byType = opsChartGroups(
      ops,
      { ...cfg, groupBy: "type" },
      "2026-10-07",
      rate,
    );
    expect(byType.map((g) => [g.key, g.values[SUM_KEY]])).toEqual([
      ["dividend", 17],
      ["yield_payment", 5],
    ]);
    const stacked = opsChartGroups(
      ops,
      { ...cfg, series: "allocationClass" },
      "2026-10-07",
      rate,
    );
    expect(stacked[0].children?.map((c) => [c.key, c.values[SUM_KEY]])).toEqual(
      [
        ["br_stocks", 10],
        ["fii", 5],
      ],
    );
  });

  it("keeps the Proventos 12m seed on its own bars", () => {
    expect(
      usesLegacyIncomeChart(
        INCOME_12M_CONFIG,
        normalizeOpsChart(INCOME_12M_CONFIG.chart),
      ),
    ).toBe(true);
    expect(
      usesLegacyIncomeChart(
        INCOME_12M_CONFIG,
        normalizeOpsChart({ type: "line" }),
      ),
    ).toBe(false);
    expect(
      usesLegacyIncomeChart({ groupBy: "type" }, normalizeOpsChart({})),
    ).toBe(false);
  });
});

describe("chart config", () => {
  it("normalizes stored charts (legacy metrics read as market value, unknown types as bar)", () => {
    expect(
      normalizeHoldingsChart({ type: "treemap", metric: "sum", top: 5 }),
    ).toEqual({
      type: "treemap",
      metric: "marketValue",
      cumulative: false,
      top: 5,
    });
    expect(normalizeHoldingsChart({ type: "waterfall" }).type).toBe("bar");
    expect(
      normalizeOpsChart({
        type: "area",
        metric: "count",
        cumulative: true,
        top: 99,
      }),
    ).toEqual({ type: "area", metric: "count", cumulative: true, top: 0 });
  });

  it("persists the layout and the chart in the view config", () => {
    const chart = { type: "donut", metric: "share", cumulative: false, top: 8 };
    const saved = { ...withLayout(DEFAULT_HOLDINGS_CONFIG, "chart"), chart };
    expect(
      normalizeHoldingsConfig(JSON.parse(JSON.stringify(saved))),
    ).toMatchObject({ layout: "chart", chart });
    expect(normalizeHoldingsConfig(withLayout(saved, "table")).layout).toBe(
      "table",
    );
    expect(
      normalizeOpsConfig({
        ...withLayout(INCOME_12M_CONFIG, "table"),
        chart: { type: "line" },
      }),
    ).toMatchObject({ layout: "table", chart: { type: "line" } });
  });
});
