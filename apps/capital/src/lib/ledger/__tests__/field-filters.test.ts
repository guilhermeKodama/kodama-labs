import { describe, expect, it } from "vitest";
import { buildHoldingsTable, DEFAULT_HOLDINGS_CONFIG, type HoldingsFilter } from "@/lib/invest/holdings-view";
import { filterOps, OPERATIONS_CONFIG, type OpsFilter } from "@/lib/invest/ops-view";
import type { Holding, Operation } from "@/lib/invest/types";
import { addableFields, fieldChipValues, setFieldChipValues } from "@/lib/ledger/field-filters";

/** Carteira's "+ Filtro" with the ledger's chip editor: property → values → Pronto, applied to positions and operations. */
function holding(id: string, over: Partial<Holding> = {}): Holding {
  return {
    id,
    accountId: "xp",
    accountName: "XP",
    entityId: "pf",
    assetClass: "stocks",
    allocationClass: "br_stocks",
    ticker: id.toUpperCase(),
    name: id,
    currency: "BRL",
    marketValueBase: 100,
    investedBase: 100,
    unrealizedGainPercent: 0,
    isActive: true,
    ...over,
  } as Holding;
}

function op(id: string, over: Partial<Operation> = {}): Operation {
  return { id, holdingId: "h1", ticker: "ITUB4", name: "Itaú", allocationClass: "br_stocks", accountId: "xp", entityId: "pf", currency: "BRL", type: "buy", totalAmount: 100, taxWithheld: 0, date: "2026-09-10", ...over } as Operation;
}

describe("field chip filters", () => {
  it("creates, changes and removes a field's in-filter, leaving other filters alone", () => {
    const keep: HoldingsFilter = { field: "entityId", op: "nin", values: ["llc"] };
    const one = setFieldChipValues<HoldingsFilter>([keep], "allocationClass", ["fii"]);
    expect(one).toEqual([keep, { field: "allocationClass", op: "in", values: ["fii"] }]);
    const two = setFieldChipValues(one, "allocationClass", ["fii", "br_stocks", "fii"]);
    expect(two[1]).toEqual({ field: "allocationClass", op: "in", values: ["fii", "br_stocks"] });
    expect(fieldChipValues(two, "allocationClass")).toEqual(["fii", "br_stocks"]);
    // A nin filter is not the chip's: its field can still get a chip.
    expect(fieldChipValues(two, "entityId")).toEqual([]);
    expect(addableFields(two, ["allocationClass", "accountId", "entityId"])).toEqual(["accountId", "entityId"]);
    expect(setFieldChipValues(two, "allocationClass", [])).toEqual([keep]);
  });

  it("filters the positions table by the values checked", () => {
    const holdings = [holding("bova11"), holding("hglg11", { allocationClass: "fii" }), holding("voo", { allocationClass: "international", accountId: "ibkr", accountName: "IBKR" })];
    const filters = setFieldChipValues<HoldingsFilter>([], "allocationClass", ["fii", "international"]);
    const table = buildHoldingsTable(holdings, [], { ...DEFAULT_HOLDINGS_CONFIG, filters });
    expect(table.groups.flatMap((g) => g.rows.map((r) => r.key)).sort()).toEqual(["hglg11", "voo"]);
    const narrower = setFieldChipValues(filters, "accountId", ["ibkr"]);
    const only = buildHoldingsTable(holdings, [], { ...DEFAULT_HOLDINGS_CONFIG, filters: narrower });
    expect(only.groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(["voo"]);
  });

  it("filters the operations by the values checked", () => {
    const ops = [op("o1"), op("o2", { type: "dividend" }), op("o3", { type: "sell", accountId: "btg" })];
    const filters = setFieldChipValues<OpsFilter>([], "type", ["dividend", "sell"]);
    expect(filterOps(ops, { ...OPERATIONS_CONFIG, filters }, "2026-10-07").map((o) => o.id).sort()).toEqual(["o2", "o3"]);
    const byBroker = setFieldChipValues(filters, "accountId", ["btg"]);
    expect(filterOps(ops, { ...OPERATIONS_CONFIG, filters: byBroker }, "2026-10-07").map((o) => o.id)).toEqual(["o3"]);
  });
});
