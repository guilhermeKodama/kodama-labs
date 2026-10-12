/**
 * The learning filter. Left of the spine, shadow mode: rows the model would
 * discard, with its score. Right of it, rows really discarded, each of which
 * can be reverted. Items are numbered, never named.
 */
export const SHADOW_ROWS = ['a', 'b', 'c', 'd'] as const;
export const KEPT_ROWS = ['a', 'b', 'c'] as const;

export const ROW = { top: 30.5, pitch: 34, height: 28, rx: 6, baseline: 18.5 } as const;

/** The strand's height: the middle of the second row. */
export const STRAND = 78.5;

/** Back across the spine: what was discarded can be restored from the audit trail. */
export const RESTORE = {
  d: 'M 600 127 C 600 172 585 184 557 184 L 160 184 C 144 184 135 176 135 162',
  head: '130,168 135,162 140,168',
} as const;
