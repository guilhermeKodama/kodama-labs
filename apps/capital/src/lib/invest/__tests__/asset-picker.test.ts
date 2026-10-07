import { describe, expect, it } from "vitest";
import { assetPickerState, clearedPick, pickKeptFor, type PickedAsset } from "../asset-picker";

const holding: PickedAsset = { type: "holding", holding: { id: "h1", ticker: "PETR4", name: "Petrobras PN", currentPrice: 38.5, currency: "BRL" } };
const market: PickedAsset = { type: "market", item: { ticker: "VOO", name: "Vanguard S&P 500", price: 512.3, currency: "USD", source: "yahoo" } as Extract<PickedAsset, { type: "market" }>["item"] };

describe("assetPickerState", () => {
  it("lists (and searches only with text) while nothing is picked", () => {
    expect(assetPickerState(null, "")).toEqual({ mode: "list", searchEnabled: false, selected: null });
    expect(assetPickerState(null, "  ")).toEqual({ mode: "list", searchEnabled: false, selected: null });
    expect(assetPickerState(null, "pet")).toEqual({ mode: "list", searchEnabled: true, selected: null });
  });

  it("switches to the compact selected row with the search off once an asset is picked", () => {
    // The query may still hold what was typed: the pick wins and the search stays off.
    expect(assetPickerState(holding, "pet")).toEqual({
      mode: "selected",
      searchEnabled: false,
      selected: { ticker: "PETR4", name: "Petrobras PN", price: 38.5, currency: "BRL", isNew: false },
    });
    expect(assetPickerState(market, "")).toMatchObject({ mode: "selected", searchEnabled: false, selected: { ticker: "VOO", price: 512.3, currency: "USD" } });
    expect(assetPickerState({ type: "custom", name: " CDB Banco X ", assetClass: "fixed_income" }, "CDB Banco X")).toEqual({
      mode: "selected",
      searchEnabled: false,
      selected: { ticker: null, name: "CDB Banco X", price: null, currency: null, isNew: true },
    });
  });

  it("does not select a new asset without a name", () => {
    expect(assetPickerState({ type: "custom", name: "  ", assetClass: "fixed_income" }, "")).toMatchObject({ mode: "list", selected: null });
  });

  it("'Trocar' clears the pick and the query, back to the list", () => {
    const cleared = clearedPick();
    expect(cleared).toEqual({ picked: null, query: "" });
    expect(assetPickerState(cleared.picked, cleared.query).mode).toBe("list");
  });

  it("drops a new asset when the operation is no longer a buy, and keeps holdings and market picks", () => {
    const custom: PickedAsset = { type: "custom", name: "CDB Banco X", assetClass: "fixed_income" };
    expect(pickKeptFor(custom, "buy")).toBe(true);
    expect(pickKeptFor(custom, "sell")).toBe(false);
    expect(pickKeptFor(custom, "income")).toBe(false);
    expect(pickKeptFor(holding, "sell")).toBe(true);
    expect(pickKeptFor(market, "income")).toBe(true);
    expect(pickKeptFor(null, "sell")).toBe(true);
  });
});
