/**
 * "Alocação atual vs alvo" (mockup AllocationBars): one bar per class with
 * money or a target, on a 0–50% scale; the tick marks the target and the
 * difference is highlighted from 3pp.
 */
import type { AllocationClass, AllocationRow } from "./types";

/** Bar scale: a share of 50% fills the bar. */
export const BAR_SCALE_MAX = 0.5;
/** A difference from the target this large (in fraction) is highlighted. */
export const DIFF_HIGHLIGHT = 0.03;

export interface AllocationBar {
  allocationClass: AllocationClass;
  share: number;
  target: number;
  /** share − target, in fraction. */
  diff: number;
  /** Bar width and tick position, 0–100 (%). */
  barWidth: number;
  tickLeft: number;
  highlight: boolean;
  /** "+2pp" / "−3pp" (U+2212 for the minus). */
  diffLabel: string;
}

export function allocationBars(allocation: readonly AllocationRow[]): AllocationBar[] {
  return allocation.map((a) => {
    const target = a.target ?? 0;
    const diff = a.share - target;
    const pp = Math.round(Math.abs(diff * 100));
    return {
      allocationClass: a.allocationClass,
      share: a.share,
      target,
      diff,
      barWidth: (Math.min(Math.max(a.share, 0), BAR_SCALE_MAX) / BAR_SCALE_MAX) * 100,
      tickLeft: (Math.min(target, BAR_SCALE_MAX) / BAR_SCALE_MAX) * 100,
      highlight: Math.abs(diff) >= DIFF_HIGHLIGHT - 1e-9,
      diffLabel: `${diff >= 0 || pp === 0 ? "+" : "−"}${pp}pp`,
    };
  });
}

/**
 * Targets typed in the dialog (percent strings in the user's number
 * format, parsed by `parse`) → the PUT body, and their sum in percent.
 */
export function targetsPayload(values: Partial<Record<AllocationClass, string>>, parse: (text: string) => number) {
  const items = (Object.entries(values) as [AllocationClass, string | undefined][])
    .map(([allocationClass, text]) => ({ allocationClass, targetPercent: text?.trim() ? parse(text) : 0 }))
    .filter((t) => Number.isFinite(t.targetPercent) && t.targetPercent > 0);
  const sum = Math.round(items.reduce((s, t) => s + t.targetPercent, 0) * 100) / 100;
  return { targets: items, sum, valid: Math.abs(sum - 100) < 0.01 && items.every((t) => t.targetPercent <= 100) };
}
