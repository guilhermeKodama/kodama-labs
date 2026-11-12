import { CANDIDATES, PIPELINE } from '@/figures/sentinel/sentinel-data';

import type { Step, Timeline } from '../timeline';

const STORY = 'alert';
const CANDIDATES_AT = 1600;
const ARRIVED = 2200;
const SCAN_AT = 2300;
/** The evaluator stands on the middle candidate: the one it confirms. */
const DECIDED = SCAN_AT + 280;

const gate = (step: Step): Step => ({ ...step, story: STORY, side: 'gate' });
const committed = (step: Step): Step => ({ ...step, story: STORY, side: 'committed' });

/**
 * The Sentinel figure. The pipeline settles column by column, one job is
 * followed from tenders to the price engine, and the engine sends its five
 * candidates to the evaluator. It reads them one by one; only when it stands
 * on the middle one does a solid line leave, and the alert is printed.
 */
export const SENTINEL_TIMELINE: Timeline = {
  id: 'sentinel',
  steps: [
    ...PIPELINE.map((column, index): Step => ({ k: `column.${column.key}`, verb: 'unfold-y', at: index * 120, d: 400 })),
    { k: 'feeds.0', verb: 'unfold', at: 400, d: 300 },
    { k: 'feeds.1', verb: 'unfold', at: 550, d: 300 },

    { k: 'job.0', verb: 'ink-x', at: 900, d: 280 },
    { k: 'job.mark.0', verb: 'set', at: 1040 },
    { k: 'job.1', verb: 'ink-x', at: 1180, d: 280 },
    { k: 'job.mark.1', verb: 'set', at: 1320 },
    { k: 'engine', verb: 'set', at: 300 },
    { k: 'engine', verb: 'pulse', at: 1460 },

    ...CANDIDATES.map((_, index): Step => ({
      k: `candidate.${index}`,
      verb: 'arrive',
      at: CANDIDATES_AT + index * 40,
      d: ARRIVED - CANDIDATES_AT - (CANDIDATES.length - 1) * 40,
      story: STORY,
      side: 'proposed',
    })),

    gate({ k: 'gate', verb: 'set', at: ARRIVED }),
    gate({ k: 'held', verb: 'set', at: ARRIVED }),
    gate({ k: 'reading', verb: 'scan', at: SCAN_AT }),

    committed({ k: 'committed', verb: 'ink-x', at: DECIDED, d: 300 }),
    committed({ k: 'alert', verb: 'unfold', at: 2800 }),
    committed({ k: 'alert.tags', verb: 'set', at: 3050 }),
    committed({ k: 'alert.title', verb: 'print', at: 3200 }),
    committed({ k: 'alert.body.0', verb: 'print', at: 3350 }),
    committed({ k: 'alert.body.1', verb: 'print', at: 3500 }),
    committed({ k: 'notes', verb: 'set', at: 3800 }),
  ],
};
