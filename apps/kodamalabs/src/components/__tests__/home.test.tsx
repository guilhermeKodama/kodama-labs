import { describe, expect, it } from 'vitest';

import { PUBLISHED_LOCALES } from '@/i18n/locales';
import { EVERYTHING_KNOWN, NOTHING_KNOWN, renderHome as render } from '@/test/home';
import { textOf as text } from '@/test/render';

const cases = PUBLISHED_LOCALES.flatMap((locale) => [
  { locale, name: 'nothing known', facts: NOTHING_KNOWN },
  { locale, name: 'everything known', facts: EVERYTHING_KNOWN },
]);

describe.each(cases)('homepage in $locale with $name', ({ locale, facts }) => {
  const html = render(locale, facts);

  it('never prints a placeholder or an empty value', () => {
    expect(text(html)).not.toMatch(/\[[A-Z][^\]\n]*\]/);
    expect(text(html)).not.toMatch(/\b(undefined|null|NaN)\b/);
    expect(html).not.toMatch(/<(dd|a|h[1-6])[^>]*>\s*<\/\1>/);
  });

  it('leaves no status line with a dangling separator', () => {
    for (const line of html.match(/<p class="font-mono[^"]*"[^>]*>.*?<\/p>/g) ?? []) {
      const shown = text(line).replace(/\n/g, '').trim();
      expect(shown).not.toMatch(/^·|·$|·\s*·/);
    }
  });

  it('has one h1 and never skips a heading level', () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.reduce((previous, level) => {
      expect(level - previous).toBeLessThanOrEqual(1);
      return level;
    }, 0);
  });

  it('points every in-page link at an element that exists', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(4);
    for (const target of targets) expect(ids, `#${target}`).toContain(target);
  });

  it('gives every figure a description', () => {
    const figures = html.match(/role="img"[^>]*>/g) ?? [];
    expect(figures.length).toBeGreaterThanOrEqual(7);
    for (const figure of figures) expect(figure).toMatch(/aria-label="[^"]{40,}"/);
  });
});

describe('facts', () => {
  it('drops the row of an unknown fact and shows it once known', () => {
    const hidden = text(render('en', NOTHING_KNOWN));
    const shown = text(render('en', EVERYTHING_KNOWN));

    expect(hidden).not.toContain('open to');
    expect(shown).toContain('open to');
    expect(shown).toContain('Example Company');
    expect(shown).toContain('sentinel.example.com');
    expect(shown).toContain('February 2026');
    expect(shown).toContain('abc1234');
  });
});
