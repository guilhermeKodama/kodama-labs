import type { CacBand, MetricStatus, Verdict } from "./types";

const BAND_STATUS: Record<CacBand["decision"], MetricStatus> = {
  DOUBLE_DOWN: "healthy",
  SCALE: "healthy",
  OPTIMIZE: "warning",
  HOLD_FIX: "warning",
  KILL: "critical",
};

// Default bands from the LTV/4 rule. Reproduces the user's R$99 example:
// LTV 590 → maxCac 147,50 → edges ~49 / ~98 / 147,50 / ~197
// (≤49 double down · até 98 scale · até 147 optimize · até 197 hold/fix · acima kill)
export function deriveCacBands(
  projectedLtvCents: number,
  maxCacCents?: number | null,
): CacBand[] {
  const max = maxCacCents ?? Math.round(projectedLtvCents / 4);
  return [
    { cacMaxCents: Math.round(max / 3), arMin: null, decision: "DOUBLE_DOWN" },
    { cacMaxCents: Math.round((2 * max) / 3), arMin: null, decision: "SCALE" },
    { cacMaxCents: max, arMin: null, decision: "OPTIMIZE" },
    { cacMaxCents: Math.round((4 * max) / 3), arMin: null, decision: "HOLD_FIX" },
    { cacMaxCents: null, arMin: null, decision: "KILL" },
  ];
}

// The validation.md decision matrices are 2-D: a row matches when CAC fits
// its ceiling AND Lead→Active clears its floor. CAC inside a row's ceiling
// with AR below its floor falls through to the next (worse) row — a cheap
// lead that doesn't activate is not a win.
export function resolveVerdict(
  cacCents: number | null,
  arValue: number | null,
  bands: CacBand[],
): Verdict {
  if (cacCents == null) {
    return { decision: "COLLECTING", status: "insufficient_data" };
  }
  for (const band of bands) {
    const cacFits = band.cacMaxCents == null || cacCents <= band.cacMaxCents;
    const arFits = band.arMin == null || arValue == null || arValue >= band.arMin;
    if (cacFits && arFits) {
      return { decision: band.decision, status: BAND_STATUS[band.decision] };
    }
  }
  return { decision: "KILL", status: "critical" };
}
