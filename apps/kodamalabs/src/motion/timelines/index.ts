import type { Timeline } from '../timeline';

import { INTRO_TIMELINE } from './intro';
import { LANES_TIMELINE } from './lanes';
import { SPINE_TIMELINE } from './spine';

/** Every timeline of the page. The tests check each one against the markup. */
export const TIMELINES: readonly Timeline[] = [INTRO_TIMELINE, LANES_TIMELINE, SPINE_TIMELINE];

/** The timelines that play together when the page loads on a wide screen. */
export const PAGE_LOAD: readonly Timeline[] = [INTRO_TIMELINE, LANES_TIMELINE, SPINE_TIMELINE];
