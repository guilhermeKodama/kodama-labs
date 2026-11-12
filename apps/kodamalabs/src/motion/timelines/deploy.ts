import { SERVICES, STEPS } from '@/figures/deploy/deploy-data';

import type { Step, Timeline } from '../timeline';

const STORY = 'deploy';
const ARRIVED = 2050;
const DECIDED = ARRIVED + 330;

/**
 * Deploys. The machine is there first: the old version is running. The steps
 * are drawn, and the failing path is shown before the passing one: it stops at
 * the spine and nothing right of it moves. Then the migration is checked,
 * passes, and a restart runs across the services.
 */
export const DEPLOY_TIMELINE: Timeline = {
  id: 'deploy',
  steps: [
    { k: 'machine', verb: 'unfold', at: 0, d: 500 },
    ...STEPS.map((step, index): Step => ({ k: `step.${step}`, verb: 'unfold', at: 300 + index * 220, d: 240 })),

    { k: 'failure', verb: 'arrive', at: 1000, d: 500 },
    { k: 'failure.stop', verb: 'set', at: 1500 },
    { k: 'failure.note', verb: 'set', at: 1550 },

    { k: 'proposal', verb: 'arrive', at: 1750, d: ARRIVED - 1750, story: STORY, side: 'proposed' },
    { k: 'held', verb: 'set', at: ARRIVED, story: STORY, side: 'gate' },
    { k: 'wait', verb: 'check', at: ARRIVED, story: STORY, side: 'gate' },
    { k: 'gate', verb: 'set', at: DECIDED, d: 110, story: STORY, side: 'gate' },

    { k: 'committed', verb: 'ink-x', at: DECIDED + 20, d: 240, story: STORY, side: 'committed' },
    ...SERVICES.map((_, index): Step => ({
      k: `service.${index}`,
      verb: 'pulse',
      at: DECIDED + 270 + index * 40,
      story: STORY,
      side: 'committed',
    })),
  ],
};
