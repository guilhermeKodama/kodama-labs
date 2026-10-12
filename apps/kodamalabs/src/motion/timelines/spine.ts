import type { Timeline } from '../timeline';

import { SPINE_AT } from './lanes';

/**
 * The page's spine, on wide screens. It starts with the first figure and is
 * inked down the screen in one stroke.
 */
export const SPINE_TIMELINE: Timeline = {
  id: 'spine',
  steps: [{ k: 'spine.page', verb: 'spine', at: SPINE_AT }],
};
