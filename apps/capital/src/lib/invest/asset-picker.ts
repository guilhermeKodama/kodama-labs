/**
 * The asset field of "Nova operação": a search box with a short list while
 * nothing is picked, and a compact "selected" row (ticker · name · price ·
 * Trocar) once an asset is picked. While an asset is selected the list is
 * gone and the market search is off; "Trocar" clears the pick and the
 * query, which brings the box and the list back.
 */
import type { AssetClass, AssetSearchItem, Holding } from "./types";

/** The asset of a buy/sell/income: one of the user's holdings, a market result or a new asset typed by hand. */
export type PickedAsset =
  | { type: "holding"; holding: Pick<Holding, "id" | "ticker" | "name" | "currentPrice" | "currency"> }
  | { type: "market"; item: Pick<AssetSearchItem, "ticker" | "name" | "price" | "currency" | "source"> }
  | { type: "custom"; name: string; assetClass: AssetClass };

export type AssetPickerMode = "selected" | "list";

export interface AssetPickerState {
  mode: AssetPickerMode;
  /** Whether the market search runs: only while the box is shown and has text. */
  searchEnabled: boolean;
  /** The compact row of the selected mode. */
  selected: { ticker: string | null; name: string; price: number | null; currency: string | null; isNew: boolean } | null;
}

/**
 * "selected" as soon as something is picked (a holding, a market result or
 * a named new asset); "list" otherwise, where the list shows the holdings
 * while the box is empty and search results while the user types.
 */
export function assetPickerState(picked: PickedAsset | null, query: string): AssetPickerState {
  if (picked && !(picked.type === "custom" && !picked.name.trim())) {
    const selected =
      picked.type === "holding"
        ? { ticker: picked.holding.ticker, name: picked.holding.name, price: picked.holding.currentPrice, currency: picked.holding.currency, isNew: false }
        : picked.type === "market"
          ? { ticker: picked.item.ticker, name: picked.item.name, price: picked.item.price, currency: picked.item.currency, isNew: false }
          : { ticker: null, name: picked.name.trim(), price: null, currency: null, isNew: true };
    return { mode: "selected", searchEnabled: false, selected };
  }
  return { mode: "list", searchEnabled: query.trim().length > 0, selected: null };
}

/**
 * Whether a pick survives a change of the operation kind. A new asset
 * typed by hand only exists for a buy (a sale or income needs a holding),
 * so switching away from "Compra" brings the box back instead of a
 * selected row that can never be saved.
 */
export function pickKeptFor(picked: PickedAsset | null, kind: string): boolean {
  return !(picked?.type === "custom" && kind !== "buy");
}

/** "Trocar": back to an empty box with no pick. */
export function clearedPick(): { picked: null; query: "" } {
  return { picked: null, query: "" };
}
