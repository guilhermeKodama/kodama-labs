import { describe, expect, it } from "vitest";
import { buildHoldingsTable, filterOptions, normalizeHoldingsConfig, toggleFilterValue, DEFAULT_HOLDINGS_CONFIG, type HoldingsViewConfig } from "../holdings-view";
import type { BrokerCash, Holding } from "../types";

function holding(over: Partial<Holding> & { id: string }): Holding {
  return {
    accountId: "xp",
    accountName: "XP",
    entityId: "pf",
    assetClass: "stocks",
    allocationClass: "br_stocks",
    allocationClassOverride: null,
    subType: null,
    ticker: over.id.toUpperCase(),
    name: over.id,
    currency: "BRL",
    currentQuantity: 10,
    averageCost: 10,
    totalInvested: 100,
    currentPrice: 12,
    lastPriceUpdate: null,
    marketValue: 120,
    unrealizedGain: 20,
    unrealizedGainPercent: 0.2,
    fxRate: 1,
    marketValueBase: 120,
    investedBase: 100,
    unrealizedGainBase: 20,
    isActive: true,
    ...over,
  } as Holding;
}

const brokers: BrokerCash[] = [
  { accountId: "xp", name: "XP", entityId: "pf", currency: "BRL", cash: 50, cashBase: 50 },
  { accountId: "ibkr", name: "IBKR", entityId: "llc", currency: "USD", cash: 10, cashBase: 54 },
];

const holdings = [
  holding({ id: "bova11", marketValueBase: 300 }),
  holding({ id: "voo", accountId: "ibkr", accountName: "IBKR", entityId: "llc", allocationClass: "international", assetClass: "international_etf", currency: "USD", marketValue: 100, fxRate: 5.4, marketValueBase: 540 }),
  holding({ id: "ipca35", allocationClass: "fixed_income", assetClass: "fixed_income", marketValueBase: 1000, unrealizedGainPercent: null }),
];

const config = (over: Partial<HoldingsViewConfig>): HoldingsViewConfig => ({ ...DEFAULT_HOLDINGS_CONFIG, ...over });

describe("buildHoldingsTable", () => {
  it("values everything in the base currency and adds the brokers' cash as one Caixa row", () => {
    const table = buildHoldingsTable(holdings, brokers, config({ groupBy: "none" }));
    expect(table.total).toBe(300 + 540 + 1000 + 50 + 54);
    expect(table.groups).toHaveLength(1);
    const rows = table.groups[0].rows;
    expect(rows.map((r) => r.key)).toEqual(["ipca35", "voo", "bova11", "cash"]);
    const cash = rows.at(-1)!;
    expect(cash).toMatchObject({ kind: "cash", value: 104, accountId: null, entityId: null, allocationClass: "cash" });
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("groups by class with the group totals, largest group first", () => {
    const table = buildHoldingsTable(holdings, brokers, config({ groupBy: "allocationClass" }));
    expect(table.groups.map((g) => [g.key, g.value])).toEqual([
      ["fixed_income", 1000],
      ["international", 540],
      ["br_stocks", 300],
      ["cash", 104],
    ]);
  });

  it("keeps one cash row per broker when grouping by broker", () => {
    const table = buildHoldingsTable(holdings, brokers, config({ groupBy: "accountId" }));
    const ibkr = table.groups.find((g) => g.key === "ibkr")!;
    expect(ibkr.rows.map((r) => r.key)).toEqual(["voo", "cash:ibkr"]);
    expect(ibkr.rows[1]).toMatchObject({ accountName: "IBKR", entityId: "llc", value: 54 });
  });

  it("filters rows but keeps the share of the whole scope", () => {
    const table = buildHoldingsTable(holdings, brokers, config({ filters: [{ field: "allocationClass", op: "in", values: ["br_stocks"] }] }));
    expect(table.count).toBe(1);
    expect(table.groups[0].rows[0].share).toBeCloseTo(300 / 1944, 10);
  });

  it("excludes with nin and leaves out inactive holdings", () => {
    const table = buildHoldingsTable([...holdings, holding({ id: "old", isActive: false })], brokers, config({ filters: [{ field: "accountId", op: "nin", values: ["ibkr"] }] }));
    expect(table.groups[0].rows.map((r) => r.key)).toEqual(["ipca35", "bova11", "cash:xp"]);
  });

  it("sorts by ticker inside a group, cash last", () => {
    const table = buildHoldingsTable(holdings, brokers, config({ sort: { field: "ticker", dir: "asc" } }));
    expect(table.groups[0].rows.map((r) => r.key)).toEqual(["bova11", "ipca35", "voo", "cash"]);
  });
});

describe("view config helpers", () => {
  it("normalizes a stored config", () => {
    expect(normalizeHoldingsConfig({ groupBy: "allocationClass", filters: [{ field: "x", op: "in", values: ["a"] }], columns: ["share"] })).toMatchObject({
      groupBy: "allocationClass",
      filters: [],
      columns: ["ticker", "share"],
      sort: { field: "marketValue", dir: "desc" },
    });
    expect(normalizeHoldingsConfig(null)).toEqual(DEFAULT_HOLDINGS_CONFIG);
  });

  it("toggles filter values and drops an empty filter", () => {
    const one = toggleFilterValue([], "accountId", "xp");
    expect(one).toEqual([{ field: "accountId", op: "in", values: ["xp"] }]);
    const two = toggleFilterValue(one, "accountId", "ibkr");
    expect(two[0].values).toEqual(["xp", "ibkr"]);
    expect(toggleFilterValue(toggleFilterValue(two, "accountId", "xp"), "accountId", "ibkr")).toEqual([]);
  });

  it("lists filter options from the scope, classes in display order", () => {
    expect(filterOptions(holdings, brokers, "allocationClass")).toEqual(["fixed_income", "br_stocks", "international", "cash"]);
    expect(filterOptions(holdings, brokers, "entityId")).toEqual(["pf", "llc"]);
  });
});
