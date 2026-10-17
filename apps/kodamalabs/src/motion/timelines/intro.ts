import type { Step, Timeline } from '../timeline';

/** Hairlines of the facts table: one above each row and one under the last. */
export const FACT_RULES = 6;

const RULE_STAGGER = 45;

/**
 * The top of the page. The name, the lede and every word are there from the
 * first frame and never move. Only the ruling is drawn: the lines of the facts
 * table, then the accent under "this line".
 */
export const INTRO_TIMELINE: Timeline = {
  id: 'intro',
  steps: [
    ...Array.from({ length: FACT_RULES }, (_, index): Step => ({
      k: `facts.rule.${index}`,
      verb: 'rule-x',
      at: index * RULE_STAGGER,
    })),
    { k: 'sentence.line', verb: 'rule-x', at: 300, d: 300 },
  ],
};
