import { SECTIONS } from '@/content/links';

import { WIDE } from '../geometry/grid';

/**
 * The first figure: one row per flagship, each a proposal that runs dashed to
 * the spine, a gate, and what it becomes. A row links to its section.
 *
 * `gate` is how the decision is drawn: a dot for one decision (a click, a
 * contract check), a bar for an evaluator that several candidates run into.
 * `decider` is who decides there, which is how the gate moves.
 */
export const LANES = [
  { key: 'capital', section: SECTIONS.capital, gate: 'dot', decider: 'person' },
  { key: 'sentinel', section: SECTIONS.sentinel, gate: 'bar', decider: 'evaluator' },
  { key: 'cosmos', section: SECTIONS.cosmos, gate: 'dot', decider: 'check' },
] as const;

export type Lane = (typeof LANES)[number];

/**
 * Vertical offset of each proposal from the lane's strand, top to bottom: at
 * its start, and where it meets the gate. A dot is reached by one proposal. A
 * bar is reached by five, and only the one on the strand passes.
 */
const PROPOSAL_OFFSETS = {
  dot: [[0, 0]],
  bar: [
    [-14, -7],
    [-7, -3.5],
    [0, 0],
    [7, 3.5],
    [14, 7],
  ],
} as const;

const HEAD_BASELINE = 20;
const FIRST_RULE = 32.5;
const ROW = 68;

const COLUMNS = {
  name: 0,
  proposes: 236,
  /** Where a proposal stops, just short of its gate. */
  proposalEnd: { dot: 695, bar: 696 },
  /** Where the committed strand leaves the gate. */
  committedStart: { dot: 710, bar: 707 },
  committedEnd: 1000,
  becomes: 1012,
} as const;

export const LANES_SHEET = {
  height: FIRST_RULE + ROW * LANES.length - 0.5,
  headBaseline: HEAD_BASELINE,
  columns: COLUMNS,
  /** y of each ruled line: above the first row and under every row. */
  rules: [
    ...LANES.map((_, index) => FIRST_RULE + ROW * index),
    FIRST_RULE + ROW * LANES.length - 1,
  ],
} as const;

/** Every coordinate of one row, derived from its index. */
export function laneGeometry(lane: Lane, index: number) {
  const top = FIRST_RULE + 0.5 + ROW * index;
  const centre = top + 33;
  const strand = centre + 8;
  const isBar = lane.gate === 'bar';
  const proposals: ReadonlyArray<readonly [number, number]> = PROPOSAL_OFFSETS[lane.gate];

  return {
    hit: { x: 0, y: top, width: WIDE.width, height: index === LANES.length - 1 ? ROW - 2 : ROW - 1 },
    name: centre - 2,
    domain: centre + 17,
    proposesLabel: isBar ? centre - 16 : centre - 12,
    heldLabel: centre - 12,
    becomesLabel: centre + 12,
    strand,
    proposalEnd: COLUMNS.proposalEnd[lane.gate],
    committedStart: COLUMNS.committedStart[lane.gate],
    proposals: proposals.map(([start, end]) => ({
      passes: start === 0,
      from: strand + start,
      to: strand + end,
    })),
    /** The box each animated half is clipped to. */
    proposedBox: { x: COLUMNS.proposes, y: strand - 20, width: 460, height: 40 },
    committedBox: {
      x: COLUMNS.committedStart[lane.gate] - 2,
      y: strand - 20,
      width: COLUMNS.committedEnd - COLUMNS.committedStart[lane.gate] + 4,
      height: 40,
    },
  };
}
