import { describe, expect, it } from 'vitest';

import { unknown } from '@/content/facts';
import { elements, messageValues, messagesFor, renderWithMessages } from '@/test/render';

import { AgentsNarrow } from '../agents/agents-narrow';
import { CapitalNarrow } from '../capital/capital-narrow';
import { CosmosNarrow } from '../cosmos/cosmos-narrow';
import { DeployNarrow } from '../deploy/deploy-narrow';
import { MONO, NARROW } from '../geometry/grid';
import { wrapLabel } from '../geometry/wrap';
import { LanesNarrow } from '../lanes/lanes-narrow';
import { PlaybookNarrow } from '../playbook/playbook-narrow';
import { SentinelNarrow } from '../sentinel/sentinel-narrow';

/** The narrow drawing of each figure. There is no mockup of these; the rules below stand in for one. */
const FIGURES = [
  { name: 'lanes', node: <LanesNarrow /> },
  { name: 'capital', node: <CapitalNarrow /> },
  { name: 'sentinel', node: <SentinelNarrow /> },
  { name: 'cosmos', node: <CosmosNarrow /> },
  { name: 'playbook', node: <PlaybookNarrow verdict={unknown()} /> },
  { name: 'agents', node: <AgentsNarrow /> },
  { name: 'deploy', node: <DeployNarrow /> },
] as const;

const MESSAGES = messageValues(messagesFor('en'));

function decode(text: string): string {
  return text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

/** Every line of text of a figure, with the attributes of its element. */
function texts(html: string): Array<{ text: string; attrs: Record<string, string> }> {
  return [...html.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((match) => ({
    text: decode(match[2]!),
    attrs: Object.fromEntries([...match[1]!.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!])),
  }));
}

describe.each(FIGURES)('narrow $name figure', ({ node }) => {
  const html = renderWithMessages(node);

  it('is drawn on the narrow sheet and described', () => {
    expect(html).toMatch(new RegExp(`<svg viewBox="0 0 ${NARROW.width} [0-9.]+"[^>]*aria-label="[^"]{40,}"`));
  });

  it('takes every word from the messages, whole or as one wrapped line of one', () => {
    const lines = texts(html);
    expect(lines.length).toBeGreaterThan(5);
    for (const { text } of lines) {
      expect(MESSAGES.some((message) => message.includes(text)), text).toBe(true);
    }
  });

  it('keeps its mono text inside the sheet', () => {
    for (const { text, attrs } of texts(html)) {
      const classes = (attrs.class ?? '').split(' ');
      // The mono face has one advance for every character, so its width is exact.
      if (classes.some((name) => name.startsWith('fig-text-ui') || name === 'fig-text-name')) continue;
      const width = text.length * (classes.includes('fig-text-small') ? MONO.small : MONO.base);
      const x = Number(attrs.x);
      const [left, right] = classes.includes('fig-text-end')
        ? [x - width, x]
        : classes.includes('fig-text-middle')
          ? [x - width / 2, x + width / 2]
          : [x, x + width];
      expect(left, text).toBeGreaterThanOrEqual(-0.5);
      expect(right, text).toBeLessThanOrEqual(NARROW.width + 0.5);
    }
  });

  it('keeps the accent for its gate rules, its gates and the marks a gate makes while it decides', () => {
    const accented = [...html.matchAll(/<[a-z]+\b[^>]*class="[^"]*fig-(?:gate|gate-open|spine|echo)\b[^>]*>/g)];
    expect(accented.length).toBeGreaterThan(1);
    for (const [tag] of accented) expect(tag).toMatch(/data-part="(spine|gate|echo)"/);
  });

  it('draws every gate on a gate rule', () => {
    const rules = elements(html, 'line')
      .filter((line) => line['data-part'] === 'spine')
      .map((line) => Number(line.y1));
    const gates = [...elements(html, 'circle'), ...elements(html, 'rect')].filter((shape) => shape['data-part'] === 'gate');
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      const centre = gate.cy ? Number(gate.cy) : Number(gate.y) + Number(gate.height) / 2;
      expect(rules, JSON.stringify(gate)).toContain(centre);
    }
  });
});

describe('wrapLabel', () => {
  it('leaves a label that fits alone', () => {
    expect(wrapLabel('my click · valid 30 min', 40)).toEqual(['my click · valid 30 min']);
  });

  it('breaks at a separator first, and drops it', () => {
    expect(wrapLabel('the assistant: 26 tools · capped at US$0.50 and 12 tool iterations a turn', 49)).toEqual([
      'the assistant: 26 tools',
      'capped at US$0.50 and 12 tool iterations a turn',
    ]);
  });

  it('then after punctuation, which it keeps', () => {
    expect(wrapLabel('95% cross-validated precision, then my switch', 41)).toEqual([
      '95% cross-validated precision,',
      'then my switch',
    ]);
  });

  it('then at a space, and leaves a word that is too long whole', () => {
    expect(wrapLabel('Companies and shareholders', 13)).toEqual(['Companies and', 'shareholders']);
    expect(wrapLabel('src/lib/__tests__/money.test.ts', 10)).toEqual(['src/lib/__tests__/money.test.ts']);
  });
});
