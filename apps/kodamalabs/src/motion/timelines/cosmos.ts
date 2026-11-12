import { STATIONS, TRANSCRIPT } from '@/figures/cosmos/cosmos-data';

import type { Step, Timeline } from '../timeline';

const LINE = 'line';
const LINE_ARRIVED = 2800;
const LINE_DECIDED = LINE_ARRIVED + 330;

/**
 * Act one, the example line. Each station is drawn and hands its delivery to
 * the next. Review returns the work once, implement and review run again, and
 * only then does a delivery reach the gate: the contracts are checked a third
 * at a time, and the draft pull request appears.
 */
export const COSMOS_LINE_TIMELINE: Timeline = {
  id: 'cosmos-line',
  steps: [
    ...STATIONS.map((station, index): Step => ({ k: `station.${station}`, verb: 'unfold', at: index * 600, d: 360 })),
    { k: 'delivery.0', verb: 'arrive', at: 360, d: 240, story: LINE, side: 'proposed' },
    { k: 'delivery.1', verb: 'arrive', at: 960, d: 240, story: LINE, side: 'proposed' },
    { k: 'return', verb: 'return-x', at: 1620, d: 500 },
    { k: 'return.note', verb: 'set', at: 1900 },
    { k: 'station.implement', verb: 'pulse', at: 2150 },
    { k: 'station.review', verb: 'pulse', at: 2380 },
    { k: 'delivery.2', verb: 'arrive', at: 2600, d: LINE_ARRIVED - 2600, story: LINE, side: 'proposed' },

    { k: 'held', verb: 'set', at: LINE_ARRIVED, story: LINE, side: 'gate' },
    { k: 'wait', verb: 'check', at: LINE_ARRIVED, story: LINE, side: 'gate' },
    { k: 'gate', verb: 'set', at: LINE_DECIDED, d: 110, story: LINE, side: 'gate' },

    { k: 'committed', verb: 'ink-x', at: LINE_DECIDED, d: 200, story: LINE, side: 'committed' },
    { k: 'pull-request', verb: 'unfold', at: LINE_DECIDED + 120, d: 360, story: LINE, side: 'committed' },
  ],
};

const RUN = 'run';
/** When each line of the transcript is printed. The refusal is instant; the longest wait is before the escalation. */
const PRINTED = [300, 700, 760, 1400, 1750, 1810, 2100];
const RUN_ARRIVED = 2500;
/** The line waits for a person: the longest hold on the page. */
const ANSWERED = RUN_ARRIVED + 900;

/**
 * Act two, a real run. The transcript is printed line by line, the item stops
 * at the gate, which stays open while it waits for a person, and resumes only
 * with the answer.
 */
export const COSMOS_RUN_TIMELINE: Timeline = {
  id: 'cosmos-run',
  steps: [
    { k: 'transcript', verb: 'unfold-y', at: 0, d: 360 },
    ...TRANSCRIPT.map((line, index): Step => ({ k: `line.${line.key}`, verb: 'print', at: PRINTED[index]! })),
    { k: 'stop', verb: 'arrive', at: 2150, d: RUN_ARRIVED - 2150, story: RUN, side: 'proposed' },

    { k: 'gate', verb: 'set', at: RUN_ARRIVED, story: RUN, side: 'gate' },
    { k: 'held', verb: 'set', at: RUN_ARRIVED, story: RUN, side: 'gate' },
    { k: 'gate', verb: 'press', at: ANSWERED, story: RUN, side: 'gate' },

    { k: 'resumed', verb: 'ink-x', at: ANSWERED + 100, d: 420, story: RUN, side: 'committed' },
    { k: 'resumed.label', verb: 'set', at: ANSWERED + 400, story: RUN, side: 'committed' },
    { k: 'after', verb: 'set', at: ANSWERED + 700, story: RUN, side: 'committed' },
  ],
};
