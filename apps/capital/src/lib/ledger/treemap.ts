/**
 * Treemap layout, ported from the mockup's Treemap (1906–1960): positive
 * values only, largest first, split in two at half the total along the
 * longer side, recursively, in a 300 × 100 box (percentages when drawn).
 * Tiles are shaded by rank: 0 strongest, 1, 2–3, then the rest.
 */

export interface TreemapItem<T = unknown> {
  value: number;
  data: T;
}

export interface TreemapRect<T = unknown> extends TreemapItem<T> {
  rank: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TREEMAP_W = 300;
export const TREEMAP_H = 100;

export function layoutTreemap<T>(items: readonly TreemapItem<T>[], width = TREEMAP_W, height = TREEMAP_H): TreemapRect<T>[] {
  const sorted = items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((item, rank) => ({ ...item, rank }));
  const out: TreemapRect<T>[] = [];
  const split = (arr: (TreemapItem<T> & { rank: number })[], x: number, y: number, w: number, h: number) => {
    if (!arr.length) return;
    if (arr.length === 1) {
      out.push({ ...arr[0], x, y, w, h });
      return;
    }
    const sum = arr.reduce((s, item) => s + item.value, 0);
    let acc = arr[0].value;
    let i = 1;
    while (i < arr.length - 1 && acc + arr[i].value <= sum / 2) {
      acc += arr[i].value;
      i++;
    }
    const f = acc / sum;
    if (w >= h) {
      split(arr.slice(0, i), x, y, w * f, h);
      split(arr.slice(i), x + w * f, y, w * (1 - f), h);
    } else {
      split(arr.slice(0, i), x, y, w, h * f);
      split(arr.slice(i), x, y + h * f, w, h * (1 - f));
    }
  };
  split(sorted, 0, 0, width, height);
  return out;
}

/** Shade step of a tile by rank: 1 (fill-1) for the largest, 2, 3 for ranks 2–3, 4 for the rest. */
export function treemapShade(rank: number): 1 | 2 | 3 | 4 {
  return rank === 0 ? 1 : rank === 1 ? 2 : rank <= 3 ? 3 : 4;
}

/** Tiles big enough for their label, value and share (mockup: area > 600 in the 300 × 100 box). */
export function showsTreemapLabel(rect: Pick<TreemapRect, "w" | "h">): boolean {
  return rect.w * rect.h > 600;
}
