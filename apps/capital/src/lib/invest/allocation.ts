/**
 * "Alocação atual vs alvo" (mockup AllocationBars): one bar per class with
 * money or a target, on a 0–50% scale; the tick marks the target and the
 * difference is highlighted from 3pp. A class without a target has no
 * tick, no "pp" and is never highlighted: a missing target is not 0%.
 */
import type { AllocationClass, AllocationRow } from "./types";

/** Bar scale: a share of 50% fills the bar. */
export const BAR_SCALE_MAX = 0.5;
/** A difference from the target this large (in fraction) is highlighted. */
export const DIFF_HIGHLIGHT = 0.03;

export interface AllocationBar {
  allocationClass: AllocationClass;
  share: number;
  /** null: the class has no target. */
  target: number | null;
  /** share − target, in fraction; null without a target. */
  diff: number | null;
  /** Bar width, 0–100 (%). */
  barWidth: number;
  /** Tick position, 0–100 (%); null without a target (no tick). */
  tickLeft: number | null;
  highlight: boolean;
  /** "+2pp" / "−3pp" (U+2212 for the minus); null without a target. */
  diffLabel: string | null;
}

export function allocationBars(allocation: readonly AllocationRow[]): AllocationBar[] {
  return allocation.map((a) => {
    const barWidth = (Math.min(Math.max(a.share, 0), BAR_SCALE_MAX) / BAR_SCALE_MAX) * 100;
    const target = a.target ?? null;
    if (target === null) return { allocationClass: a.allocationClass, share: a.share, target, diff: null, barWidth, tickLeft: null, highlight: false, diffLabel: null };
    const diff = a.share - target;
    const pp = Math.round(Math.abs(diff * 100));
    return {
      allocationClass: a.allocationClass,
      share: a.share,
      target,
      diff,
      barWidth,
      tickLeft: (Math.min(target, BAR_SCALE_MAX) / BAR_SCALE_MAX) * 100,
      highlight: Math.abs(diff) >= DIFF_HIGHLIGHT - 1e-9,
      diffLabel: `${diff >= 0 || pp === 0 ? "+" : "−"}${pp}pp`,
    };
  });
}

/** Whether any class has a target (otherwise the panel says "Defina alvos para comparar"). */
export function hasTargets(allocation: readonly AllocationRow[]): boolean {
  return allocation.some((a) => a.target !== null && a.target !== undefined);
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
