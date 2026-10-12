import type { Timeline } from '../timeline';

import { AGENTS_TIMELINE } from './agents';
import { CAPITAL_TIMELINE } from './capital';
import { COSMOS_LINE_TIMELINE, COSMOS_RUN_TIMELINE } from './cosmos';
import { DEPLOY_TIMELINE } from './deploy';
import { INTRO_TIMELINE } from './intro';
import { LANES_TIMELINE } from './lanes';
import { PLAYBOOK_TIMELINE } from './playbook';
import { SENTINEL_TIMELINE } from './sentinel';
import { TRIAGE_TIMELINE } from './triage';

/** Every timeline of the page, in page order. The tests check each one against the markup. */
export const TIMELINES: readonly Timeline[] = [
  INTRO_TIMELINE,
  LANES_TIMELINE,
  CAPITAL_TIMELINE,
  SENTINEL_TIMELINE,
  COSMOS_LINE_TIMELINE,
  COSMOS_RUN_TIMELINE,
  TRIAGE_TIMELINE,
  PLAYBOOK_TIMELINE,
  AGENTS_TIMELINE,
  DEPLOY_TIMELINE,
];

/** The timelines that play together when the page loads. */
export const PAGE_LOAD: readonly Timeline[] = [INTRO_TIMELINE, LANES_TIMELINE];
