import { KEPT_ROWS, SHADOW_ROWS } from '@/figures/triage/triage-data';

import type { Step, Timeline } from '../timeline';

const STORY = 'discard';
const ARRIVED = 800;
/** The gate has two conditions: measured precision, then my switch. */
const MEASURED = ARRIVED + 330;
const SWITCHED = 1260 + 81;

const gate = (step: Step): Step => ({ ...step, story: STORY, side: 'gate' });
const committed = (step: Step): Step => ({ ...step, story: STORY, side: 'committed' });

/**
 * The learning filter. Shadow rows are drawn dashed; the gate is first
 * checked, then pressed. The discarded rows then print almost at once, the
 * fastest moment of the page: after the gate the model acts alone. The loop
 * that restores them and the two limits come last.
 */
export const TRIAGE_TIMELINE: Timeline = {
  id: 'triage',
  steps: [
    ...SHADOW_ROWS.map((row, index): Step => ({
      k: `shadow.${row}`,
      verb: 'unfold',
      at: index * 90,
      d: 300,
      story: STORY,
      side: 'proposed',
    })),
    { k: 'proposal', verb: 'arrive', at: 600, d: ARRIVED - 600, story: STORY, side: 'proposed' },

    gate({ k: 'held', verb: 'set', at: ARRIVED }),
    gate({ k: 'wait', verb: 'check', at: ARRIVED }),
    gate({ k: 'gate', verb: 'set', at: MEASURED, d: 100 }),
    gate({ k: 'gate', verb: 'press', at: 1260 }),
    gate({ k: 'echo', verb: 'ripple', at: SWITCHED }),

    committed({ k: 'committed', verb: 'ink-x', at: SWITCHED, d: 140 }),
    ...KEPT_ROWS.map((row, index) => committed({ k: `kept.${row}`, verb: 'print', at: 1500 + index * 60 })),
    committed({ k: 'restore', verb: 'return-x', at: 1900 }),
    committed({ k: 'restored', verb: 'set', at: 2400 }),
    committed({ k: 'limits', verb: 'set', at: 2700 }),
  ],
};
