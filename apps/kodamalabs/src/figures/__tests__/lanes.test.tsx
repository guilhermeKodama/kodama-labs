import { describe, expect, it } from 'vitest';

import { SECTIONS } from '@/content/links';
import { elements, messageValues, messagesFor, renderWithMessages, textOf } from '@/test/render';

import { WIDE } from '../geometry/grid';
import { LANES } from '../lanes/lanes-data';
import { LanesFigure } from '../lanes/lanes-figure';

const html = renderWithMessages(<LanesFigure />);

/** Splits the figure into the markup of each lane link. */
const lanes = html.split('<a ').slice(1).map((chunk) => `<a ${chunk.split('</a>')[0]}</a>`);

describe('lanes figure', () => {
  it('is a labelled group of one link per flagship', () => {
    expect(html).toMatch(/<svg[^>]*role="group"[^>]*aria-label="[^"]{40,}"/);
    expect(lanes).toHaveLength(LANES.length);
    const targets = elements(html, 'a').map((a) => a.href);
    expect(targets).toEqual(LANES.map((lane) => `#${lane.section}`));
    for (const target of targets) expect(Object.values(SECTIONS).map((id) => `#${id}`)).toContain(target);
  });

  it('draws exactly one gate per lane, on the spine', () => {
    const gates = [...elements(html, 'circle'), ...elements(html, 'rect')].filter(
      (shape) => shape['data-part'] === 'gate',
    );
    expect(gates).toHaveLength(LANES.length);
    for (const gate of gates) {
      const centre = gate.cx ? Number(gate.cx) : Number(gate.x) + Number(gate.width) / 2;
      expect(centre).toBe(WIDE.spine);
    }
  });

  it('keeps the accent for the spine, the gates and the marks a gate makes while it decides', () => {
    const accented = [...html.matchAll(/<[a-z]+\b[^>]*class="[^"]*fig-(?:gate|gate-open|spine|echo)\b[^>]*>/g)];
    const parts = accented.map(([tag]) => /data-part="([a-z]+)"/.exec(tag)?.[1]);
    expect(parts.filter((part) => part === 'spine')).toHaveLength(1);
    expect(parts.filter((part) => part === 'gate')).toHaveLength(LANES.length);
    expect(parts.every((part) => part === 'spine' || part === 'gate' || part === 'echo')).toBe(true);
    // Those marks are not part of the finished drawing.
    for (const [tag] of accented) {
      if (tag.includes('data-part="echo"')) expect(tag).toContain('m-transient');
    }
  });

  it('stops every proposal short of its gate and resumes after it at the same height', () => {
    for (const lane of lanes) {
      const proposed = elements(lane, 'line').filter((line) => line.class === 'fig-proposed');
      const committed = elements(lane, 'line').filter((line) => line.class === 'fig-committed');
      expect(proposed).toHaveLength(1);
      expect(committed).toHaveLength(1);
      expect(Number(proposed[0]!.x2)).toBeLessThan(WIDE.spine);
      expect(Number(committed[0]!.x1)).toBeGreaterThan(WIDE.spine);
      expect(proposed[0]!.y2).toBe(committed[0]!.y1);
    }
  });

  it('takes every word from the messages', () => {
    const known = new Set(messageValues(messagesFor('en')));
    const words = textOf(html)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(words.length).toBeGreaterThan(12);
    for (const word of words) expect(known, word).toContain(word);
  });
});
