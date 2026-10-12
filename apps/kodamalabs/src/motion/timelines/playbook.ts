import { IDEA_END, MARKS } from '@/figures/playbook/playbook-data';

import type { Step, Timeline } from '../timeline';

const START = 200;
const TRAVEL = 900;

/**
 * The validation playbook. An idea advances at an even pace, because this is
 * time passing; each mark sets as the line goes by it. It ends at the gate,
 * and the gate does not move: nothing here shows a verdict that is not there.
 */
export const PLAYBOOK_TIMELINE: Timeline = {
  id: 'playbook',
  steps: [
    { k: 'axis', verb: 'unfold', at: 0, d: 360 },
    { k: 'milhas', verb: 'advance', at: START, d: TRAVEL },
    ...MARKS.map((mark): Step => ({
      k: `mark.${mark.key}`,
      verb: 'set',
      at: START + Math.round((TRAVEL * mark.x) / IDEA_END),
    })),
    { k: 'gate', verb: 'set', at: START + TRAVEL },
    { k: 'criteria', verb: 'set', at: START + TRAVEL },
    { k: 'verdict', verb: 'set', at: START + TRAVEL + 50 },
    { k: 'fire', verb: 'advance', at: 1300, d: 200 },
    { k: 'fire.label', verb: 'set', at: 1500 },
  ],
};
