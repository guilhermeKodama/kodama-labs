/**
 * The two drawing sheets. A wide figure spans the container (1200 units); a
 * strip figure spans its right 66% (792 units). In both, `spine` is the x of
 * the page's accent line, so a figure's own spine sits exactly on it:
 * 58.5% of 1200 = 702, and 702 - 408 (where a strip starts) = 294. The half
 * unit centres a 1-unit stroke on the pixel.
 */
export const WIDE = {
  width: 1200,
  spine: 702.5,
  /** Where labels right of the spine start. */
  right: 722,
} as const;

export const STRIP = {
  width: 792,
  spine: 294.5,
  right: 318,
} as const;

export type Sheet = typeof WIDE | typeof STRIP;

/**
 * The sheet of a figure on a narrow screen, where there is no room beside the
 * spine. The drawing turns a quarter: it reads top to bottom, and the gate is
 * a horizontal rule the flow crosses on its way down. 340 units is about the
 * width of a phone's column, so text keeps its size.
 */
export const NARROW = { width: 340 } as const;

/** Advance of one character of the figure's mono face, per text size. */
export const MONO = { base: 6.9, small: 6.3 } as const;
