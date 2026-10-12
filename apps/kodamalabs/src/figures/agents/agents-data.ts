/**
 * Working with coding agents. Branches fan out from a written contract, run
 * dashed to the gate (lint, typecheck, tests, then my merge), and the ones
 * that pass merge into main. One does not pass.
 */

/** Height of each branch where it meets the gate, top to bottom. */
export const BRANCHES = [45, 75, 105, 135, 165, 195] as const;

/** How many of them merge: the first ones. The last is closed, not merged. */
export const MERGED = 5;

/** The strand of the contract and of main. */
export const STRAND = 120;

export function branchPath(y: number): string {
  return `M 44 ${STRAND} C 150 ${STRAND} 170 ${y} 291 ${y}`;
}

export function mergePath(y: number): string {
  return `M 298 ${y} C 360 ${y} 380 ${STRAND} 440 ${STRAND}`;
}

export const MAIN = { from: 440, to: 700, commits: [470, 500, 530, 560, 590, 620, 650, 680] } as const;

/** The contract, drawn as a page with a folded corner and three lines of text. */
export const CONTRACT = {
  page: 'M 0.5 100.5 L 20.5 100.5 L 28.5 108.5 L 28.5 138.5 L 0.5 138.5 Z',
  fold: 'M 20.5 100.5 L 20.5 108.5 L 28.5 108.5',
  lines: [
    [117.5, 22],
    [123.5, 22],
    [129.5, 16],
  ],
} as const;
