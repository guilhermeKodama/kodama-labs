import type { AssetClass } from "@/generated/prisma";
import type { PricePoint } from "./provider";

/**
 * The one sanity gate every price crosses before it reaches AssetPrice — the
 * trade for not having a persistent circuit breaker or multi-source
 * consensus (see the F1 plan's "Robustez" section): cheap, synchronous,
 * no cross-provider comparison required.
 *
 * "suspect" is not a failure: the point is still written (status:"suspect"),
 * just not treated as the asset's current price until confirmed. The
 * caller (sync-prices.ts) is the one that, on writing a fresh "ok" point,
 * promotes a prior "suspect" row for the same asset to "ok" once this
 * function says the new point is within tolerance of it — two similar
 * closes in a row turn a real jump (split, re-listing) from "suspect" into
 * "ok", one day late. A sustained bad feed instead keeps producing
 * "suspect" rows forever, which is the signal that something is wrong.
 */

export type AcceptPriceVerdict = { status: "ok" } | { status: "suspect" | "rejected"; reason: string };

export interface AcceptPriceInput {
  point: PricePoint;
  /** Only this asset's currency and class matter here. */
  asset: { currency: string; assetClass: AssetClass };
  /** The most recent AssetPrice already on file for this asset (any status), if any. */
  previous?: { close: number; status: string } | null;
  now?: Date;
}

/** Share moved more than this since the last close counts as a jump, not noise. */
const JUMP_LIMIT: Partial<Record<AssetClass, number>> = {
  crypto: 0.5,
  fii: 0.15,
};
const DEFAULT_JUMP_LIMIT = 0.2;
const ONE_DAY_MS = 86_400_000;

export function acceptPrice({ point, asset, previous, now = new Date() }: AcceptPriceInput): AcceptPriceVerdict {
  if (point.currency.toUpperCase() !== asset.currency.toUpperCase()) {
    return { status: "rejected", reason: `moeda ${point.currency} não corresponde à moeda do ativo (${asset.currency})` };
  }
  if (!Number.isFinite(point.close) || point.close <= 0) {
    return { status: "rejected", reason: `fechamento inválido: ${point.close}` };
  }
  const pointDate = new Date(`${point.date}T00:00:00Z`);
  if (Number.isNaN(pointDate.getTime())) {
    return { status: "rejected", reason: `data inválida: ${point.date}` };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // A day of slack: a provider in another timezone can report "today" while it's already tomorrow UTC.
  if (pointDate.getTime() > today + ONE_DAY_MS) {
    return { status: "rejected", reason: `data futura: ${point.date}` };
  }
  if (!previous) return { status: "ok" };
  const limit = JUMP_LIMIT[asset.assetClass] ?? DEFAULT_JUMP_LIMIT;
  const change = Math.abs(point.close - previous.close) / previous.close;
  if (change <= limit) return { status: "ok" };
  return { status: "suspect", reason: `variou ${(change * 100).toFixed(1)}% desde o fechamento anterior (${previous.close}), acima do limite de ${(limit * 100).toFixed(0)}% para ${asset.assetClass}` };
}
