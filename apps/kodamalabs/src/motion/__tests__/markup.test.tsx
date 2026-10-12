import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVERYTHING_KNOWN, NOTHING_KNOWN, renderHome } from '@/test/home';
import { figuresOf } from '@/test/render';

import { timelineKeys, verbSpec, VERBS } from '../timeline';
import { TIMELINES } from '../timelines';

const complete = figuresOf(renderHome('en', EVERYTHING_KNOWN));
const minimal = figuresOf(renderHome('en', NOTHING_KNOWN));

describe('figures in the page', () => {
  it('are rendered waiting, each with a timeline, never one inside another', () => {
    expect(complete.length).toBeGreaterThanOrEqual(TIMELINES.length);
    for (const figure of complete) {
      expect(figure.state, figure.id).toBe('idle');
      expect(figure.nested, figure.id).toBe(false);
    }
    const animated = complete.filter((figure) => figure.keys.length > 0).map((figure) => figure.id);
    expect(animated.sort()).toEqual(TIMELINES.map((timeline) => timeline.id).sort());
  });

  it('start together only with a figure that exists', () => {
    for (const figure of complete) {
      if (figure.follows) expect(complete.map((other) => other.id)).toContain(figure.follows);
    }
  });

  it.each(TIMELINES.map((timeline) => ({ id: timeline.id, timeline })))(
    '$id has exactly the parts its timeline moves',
    ({ timeline }) => {
      const figure = complete.find((candidate) => candidate.id === timeline.id)!;
      expect([...figure.keys].sort()).toEqual(timelineKeys(timeline).sort());
      expect(new Set(figure.keys).size).toBe(figure.keys.length);

      // With facts missing, rows disappear; what is left is still in the timeline.
      const fewer = minimal.find((candidate) => candidate.id === timeline.id)!;
      for (const key of fewer.keys) expect(timelineKeys(timeline)).toContain(key);
    },
  );

  it('marks as transient exactly the parts that only exist while they run', () => {
    for (const timeline of TIMELINES) {
      const figure = complete.find((candidate) => candidate.id === timeline.id)!;
      for (const key of figure.keys) {
        const transient = timeline.steps
          .filter((step) => step.k === key)
          .every((step) => verbSpec(step.verb).transient);
        const classes = (figure.parts[key]!.class ?? '').split(' ');
        expect(classes.includes('m-transient'), `${timeline.id}: ${key}`).toBe(transient);
      }
    }
  });

  it('gives a ring that completes in parts a length of one', () => {
    for (const timeline of TIMELINES) {
      const figure = complete.find((candidate) => candidate.id === timeline.id)!;
      for (const step of timeline.steps.filter((candidate) => candidate.verb === 'check')) {
        expect(figure.parts[step.k]!.pathLength, step.k).toBe('1');
      }
    }
  });
});

describe('verbs.css', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../verbs.css'), 'utf8');
  const declared = [...css.matchAll(/@keyframes\s+([a-z-]+)/g)].map((match) => match[1]!);

  it('declares the keyframes every verb names, and no others', () => {
    const used = new Set([...Object.values(VERBS).map((verb) => verb.keyframes), 'm-flow']);
    expect([...declared].sort()).toEqual([...used].sort());
  });

  it('applies only to a visit that was given motion', () => {
    const rules = css
      .slice(css.indexOf('@media'), css.indexOf('@keyframes'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).toMatch(/^@media screen and \(prefers-reduced-motion: no-preference\)/);
    const selectors = [...rules.matchAll(/^ {2}([^\s}][^{]*)\{/gm)].flatMap((match) => match[1]!.split(/,\n/));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector.trim()).toMatch(/^html\.m-on /);
  });
});
