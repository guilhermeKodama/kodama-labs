import { describe, expect, it } from 'vitest';

import {
  bind,
  decidedAt,
  stepDuration,
  stepEnd,
  timelineDuration,
  timelineKeys,
  verbSpec,
  type Step,
  type Timeline,
} from '../timeline';
import { PAGE_LOAD, TIMELINES } from '../timelines';

/** The proposal → gate → commit stories of a timeline, by name. */
function stories(timeline: Timeline): Map<string, Step[]> {
  const byStory = new Map<string, Step[]>();
  for (const step of timeline.steps) {
    if (step.story) byStory.set(step.story, [...(byStory.get(step.story) ?? []), step]);
  }
  return byStory;
}

it('names every timeline once', () => {
  const ids = TIMELINES.map((timeline) => timeline.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('finishes the page-load choreography within 2.6 seconds', () => {
  expect(Math.max(...PAGE_LOAD.map(timelineDuration))).toBeLessThanOrEqual(2600);
});

describe.each(TIMELINES.map((timeline) => ({ id: timeline.id, timeline })))('timeline $id', ({ timeline }) => {
  it('has steps with a start and a length in whole milliseconds', () => {
    expect(timeline.steps.length).toBeGreaterThan(0);
    for (const step of timeline.steps) {
      expect(Number.isInteger(step.at), step.k).toBe(true);
      expect(step.at, step.k).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(stepDuration(step)), step.k).toBe(true);
      expect(stepDuration(step), step.k).toBeGreaterThanOrEqual(60);
      expect(stepDuration(step), step.k).toBeLessThanOrEqual(1200);
    }
  });

  it('never runs two steps of one part at the same time', () => {
    for (const key of timelineKeys(timeline)) {
      const steps = timeline.steps.filter((step) => step.k === key).sort((a, b) => a.at - b.at);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]!.at, key).toBeGreaterThanOrEqual(stepEnd(steps[i - 1]!));
      }
    }
  });

  it('hides a part until its first step, unless the part is a transient mark', () => {
    for (const key of timelineKeys(timeline)) {
      const steps = timeline.steps.filter((step) => step.k === key).sort((a, b) => a.at - b.at);
      const transient = steps.every((step) => verbSpec(step.verb).transient);
      if (!transient) expect(verbSpec(steps[0]!.verb).fill, key).toBe('both');
      // A part is either a mark that only exists while it runs, or a part of the drawing.
      expect(steps.some((step) => verbSpec(step.verb).transient), key).toBe(transient);
    }
  });

  it('keeps at most twelve parts moving at once', () => {
    for (const step of timeline.steps) {
      const moving = timeline.steps.filter((other) => other.at <= step.at && stepEnd(other) > step.at);
      expect(moving.length, `at ${step.at}ms`).toBeLessThanOrEqual(12);
    }
  });

  it('moves the accent only at a gate', () => {
    for (const step of timeline.steps) {
      if (verbSpec(step.verb).gateOnly) expect(step.side, step.k).toBe('gate');
    }
  });

  it('tells every story in order: the proposal arrives, the gate decides, then it commits', () => {
    for (const [name, steps] of stories(timeline)) {
      const proposed = steps.filter((step) => step.side === 'proposed');
      const gate = steps.filter((step) => step.side === 'gate');
      const committed = steps.filter((step) => step.side === 'committed');
      expect(proposed.length, name).toBeGreaterThan(0);
      expect(committed.length, name).toBeGreaterThan(0);

      const arrived = Math.max(...proposed.map(stepEnd));
      const decisions = gate.map(decidedAt).filter((at) => at !== undefined);
      // One decision per story, made after the whole proposal stands at the gate.
      expect(decisions, name).toHaveLength(1);
      const decided = decisions[0]!;
      for (const step of gate) expect(step.at, `${name}: ${step.k}`).toBeGreaterThanOrEqual(arrived);
      // Nothing is committed before the gate has decided.
      for (const step of committed) expect(step.at, `${name}: ${step.k}`).toBeGreaterThanOrEqual(decided);
    }
  });
});

describe('bind', () => {
  const timeline: Timeline = {
    id: 'sample',
    steps: [
      { k: 'strand', verb: 'arrive', at: 100, d: 300 },
      { k: 'gate', verb: 'set', at: 400, d: 100 },
      { k: 'gate', verb: 'press', at: 500 },
      { k: 'rule', verb: 'rule-x', at: 0 },
    ],
  };
  const m = bind(timeline);

  it('gives a part its schedule as one animation per step', () => {
    expect(m('gate')).toEqual({
      'data-k': 'gate',
      style: { '--m': 'm-set 100ms ease-out 400ms both, m-press 180ms ease-in-out 500ms none' },
    });
  });

  it('adds the flow of the dashes to an arriving part, and the origin a verb grows from', () => {
    expect(m('strand').style).toEqual({
      '--m': 'm-wipe-x 300ms var(--m-draft) 100ms both',
      '--flow': 'm-flow 300ms var(--m-draft) 100ms both',
    });
    expect(m('rule').style).toMatchObject({ '--o': 'left center' });
  });

  it('refuses a key the timeline does not have', () => {
    expect(() => m('typo')).toThrow(/no step for "typo"/);
  });
});
