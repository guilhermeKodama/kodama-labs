import { PLAN_ROWS } from '@/figures/capital/capital-data';

import type { Step, Timeline } from '../timeline';

const STORY = 'import';
const ARRIVED = 1400;
/** The reader's click on Confirm. Until here nothing is written. */
const CLICK = 2100;
const DECIDED = CLICK + 81;

const proposed = (step: Step): Step => ({ ...step, story: STORY, side: 'proposed' });
const gate = (step: Step): Step => ({ ...step, story: STORY, side: 'gate' });
const committed = (step: Step): Step => ({ ...step, story: STORY, side: 'committed' });

/** A column of the cash flow: its bars grow, their names set, the money leaves them. */
function flowColumn(column: number, at: number): Step[] {
  const steps: Step[] = [
    { k: `flow.nodes.${column}`, verb: 'rise', at, d: 300 },
    { k: `flow.names.${column}`, verb: 'set', at: at + 150 },
  ];
  if (column < 3) steps.push({ k: `flow.ribbons.${column}`, verb: 'unfold', at: at + 200, d: 360 });
  return steps.map(committed);
}

/**
 * The Capital figure. The plan is drawn in as a proposal and stops at the
 * gate, which waits: this is the longest pause of the figure. Only the click
 * on Confirm sets the gate; then the plan becomes ledger rows, the ledger is
 * read as a cash flow column by column, and the undo loop is drawn back.
 */
export const CAPITAL_TIMELINE: Timeline = {
  id: 'capital',
  steps: [
    proposed({ k: 'plan.frame', verb: 'unfold', at: 0 }),
    ...PLAN_ROWS.map((row, index) => proposed({ k: `plan.row.${row}`, verb: 'unfold', at: 200 + index * 70, d: 320 })),
    proposed({ k: 'plan.more', verb: 'set', at: 760 }),
    proposed({ k: 'plan.waiting', verb: 'set', at: 900 }),
    proposed({ k: 'confirm', verb: 'set', at: 900 }),
    proposed({ k: 'proposal', verb: 'arrive', at: 1000, d: ARRIVED - 1000 }),

    gate({ k: 'wait', verb: 'wait', at: ARRIVED, d: CLICK - ARRIVED }),
    gate({ k: 'held', verb: 'set', at: ARRIVED }),
    gate({ k: 'confirm', verb: 'press', at: CLICK }),
    gate({ k: 'gate', verb: 'set', at: DECIDED, d: 100 }),
    gate({ k: 'echo', verb: 'ripple', at: DECIDED }),

    committed({ k: 'committed', verb: 'ink-x', at: DECIDED + 19, d: 420 }),
    committed({ k: 'ledger', verb: 'set', at: 2500 }),
    committed({ k: 'views', verb: 'unfold', at: 2600 }),
    ...flowColumn(0, 2800),
    ...flowColumn(1, 3250),
    ...flowColumn(2, 3700),
    ...flowColumn(3, 4150),
    committed({ k: 'undo', verb: 'return-x', at: 4000 }),
    committed({ k: 'undo.note', verb: 'set', at: 4500 }),
  ],
};

/** Where the figure stands while it waits for the reader: just before the click. */
export const CAPITAL_HOLD_AT = CLICK - 1;
