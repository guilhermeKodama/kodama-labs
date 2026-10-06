/**
 * Waterfall steps, ported from the mockup's Waterfall (1962–2011): the
 * positive groups largest first, then the negative ones from the most
 * negative, each starting where the previous ended, and a final
 * "Resultado" bar from zero to the end. `scale` maps values to pixels
 * from the top of a box of `height`, with zero inside the range.
 */

export type WaterfallKind = "pos" | "neg" | "total";

export interface WaterfallStep<T = unknown> {
  /** null for the Resultado bar. */
  data: T | null;
  value: number;
  start: number;
  end: number;
  kind: WaterfallKind;
}

export function waterfallSteps<T>(items: readonly { value: number; data: T }[]): WaterfallStep<T>[] {
  const ordered = [...items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value), ...items.filter((i) => i.value < 0).sort((a, b) => a.value - b.value)];
  let run = 0;
  const steps: WaterfallStep<T>[] = ordered.map((item) => {
    const start = run;
    run += item.value;
    return { data: item.data, value: item.value, start, end: run, kind: item.value >= 0 ? "pos" : "neg" };
  });
  steps.push({ data: null, value: run, start: 0, end: run, kind: "total" });
  return steps;
}

/** y (px from the top) of a value in a box of `height`, for these steps (mockup y()). */
export function waterfallScale(steps: readonly WaterfallStep[], height: number): (value: number) => number {
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)));
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)));
  return (value: number) => ((hi - value) / (hi - lo || 1)) * height;
}

/** Top and height of a step's bar (at least 2px). */
export function waterfallBar(step: WaterfallStep, y: (value: number) => number): { top: number; height: number } {
  return { top: y(Math.max(step.start, step.end)), height: Math.max(2, Math.abs(y(step.start) - y(step.end))) };
}
