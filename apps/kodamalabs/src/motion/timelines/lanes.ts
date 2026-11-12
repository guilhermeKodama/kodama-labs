import { LANES, laneGeometry, type Lane } from '@/figures/lanes/lanes-data';

import type { Step, Timeline } from '../timeline';

/** The spine starts to draw here; the lanes follow. */
export const SPINE_AT = 450;
const RULE_STAGGER = 60;
const FIRST_LANE_AT = 700;
const LANE_STAGGER = 160;
/** From the first dash of a lane to its last proposal standing at the gate. */
const ARRIVE = 600;
const CANDIDATE_STAGGER = 40;

/**
 * How each kind of gate decides, from the moment the proposal has arrived.
 * The motion says who decided:
 *
 *   person     a hollow ring waits, the dot sets, is pressed, and ripples once
 *   evaluator  the bar fills from the top in five steps, one per candidate
 *   check      a ring completes a third at a time, then the dot sets
 *
 * `decided` is when the committed strand may start.
 */
function decision(lane: Lane, at: number): { steps: Step[]; decided: number } {
  const key = lane.key;

  switch (lane.decider) {
    case 'person':
      return {
        steps: [
          { k: `${key}.wait`, verb: 'wait', at },
          { k: `${key}.gate`, verb: 'set', at: at + 140, d: 100 },
          { k: `${key}.gate`, verb: 'press', at: at + 240 },
          { k: `${key}.echo`, verb: 'ripple', at: at + 321 },
        ],
        decided: at + 321,
      };
    case 'evaluator':
      return { steps: [{ k: `${key}.gate`, verb: 'stamp', at }], decided: at + 400 };
    case 'check':
      return {
        steps: [
          { k: `${key}.wait`, verb: 'check', at },
          { k: `${key}.gate`, verb: 'set', at: at + 330, d: 110 },
        ],
        decided: at + 330,
      };
  }
}

/** One lane: its proposals arrive, the gate decides, the result is inked and named. */
function laneSteps(lane: Lane, index: number): Step[] {
  const key = lane.key;
  const start = FIRST_LANE_AT + index * LANE_STAGGER;
  const proposals = laneGeometry(lane, index).proposals.length;
  const arrived = start + ARRIVE;
  const { steps, decided } = decision(lane, arrived);

  return [
    ...Array.from({ length: proposals }, (_, proposal): Step => ({
      k: `${key}.proposed.${proposal}`,
      verb: 'arrive',
      at: start + proposal * CANDIDATE_STAGGER,
      d: ARRIVE - (proposals - 1) * CANDIDATE_STAGGER,
      story: key,
      side: 'proposed',
    })),
    { k: `${key}.held`, verb: 'set', at: arrived, story: key, side: 'gate' },
    ...steps.map((step): Step => ({ ...step, story: key, side: 'gate' })),
    { k: `${key}.committed`, verb: 'ink-x', at: decided, story: key, side: 'committed' },
    { k: `${key}.becomes`, verb: 'set', at: decided + 260, story: key, side: 'committed' },
  ];
}

/**
 * The first figure. Its ruling and its piece of the spine are drawn, then the
 * three lanes play a beat apart: proposal, gate, commit.
 */
export const LANES_TIMELINE: Timeline = {
  id: 'lanes',
  steps: [
    { k: 'spine', verb: 'ink-y', at: SPINE_AT },
    ...[0, 1, 2, 3].map((index): Step => ({
      k: `rule.${index}`,
      verb: 'rule-x',
      at: SPINE_AT + index * RULE_STAGGER,
      d: 420,
    })),
    ...LANES.flatMap(laneSteps),
  ],
};
