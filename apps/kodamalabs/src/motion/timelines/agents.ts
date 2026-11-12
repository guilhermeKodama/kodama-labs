import { BRANCHES, MAIN, MERGED } from '@/figures/agents/agents-data';

import type { Step, Timeline } from '../timeline';

const STORY = 'merge';
const ARRIVED = 1130;
const DECIDED = ARRIVED + 480;

const committed = (step: Step): Step => ({ ...step, story: STORY, side: 'committed' });

/**
 * Working with coding agents. The contract is there first, the branches leave
 * it and run to the gate, and the gate fills step by step. The ones that pass
 * merge into main one at a time, each leaving a commit; the last is closed.
 */
export const AGENTS_TIMELINE: Timeline = {
  id: 'agents',
  steps: [
    { k: 'contract', verb: 'unfold', at: 0 },
    ...BRANCHES.map((_, index): Step => ({
      k: `branch.${index}`,
      verb: 'arrive',
      at: 300 + index * 70,
      d: ARRIVED - 300 - (BRANCHES.length - 1) * 70,
      story: STORY,
      side: 'proposed',
    })),
    { k: 'worktrees', verb: 'set', at: 700 },

    { k: 'held', verb: 'set', at: ARRIVED, story: STORY, side: 'gate' },
    { k: 'gate', verb: 'stamp', at: ARRIVED, d: DECIDED - ARRIVED, story: STORY, side: 'gate' },

    ...BRANCHES.slice(0, MERGED).map((_, index) => committed({ k: `merge.${index}`, verb: 'ink-x', at: DECIDED + index * 150, d: 360 })),
    committed({ k: 'closed', verb: 'set', at: DECIDED + 100 }),
    committed({ k: 'main', verb: 'ink-x', at: DECIDED + 300, d: 700 }),
    ...MAIN.commits.map((_, index) => committed({ k: `commit.${index}`, verb: 'set', at: DECIDED + 420 + index * 90 })),
    committed({ k: 'main.label', verb: 'set', at: DECIDED + 1100 }),
  ],
};
