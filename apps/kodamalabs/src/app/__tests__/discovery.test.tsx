import { describe, expect, it } from 'vitest';

import { PersonJsonLd } from '@/components/person-json-ld';
import { EMAIL, LINKS, SITE_URL } from '@/content/links';
import { PUBLISHED_LOCALES } from '@/i18n/locales';
import { messagesFor, renderWithMessages, type MessageTree } from '@/test/render';

import robots from '../robots';
import sitemap from '../sitemap';

describe('what search engines are told', () => {
  it('lists one page per published language, on the public address', () => {
    const pages = sitemap();
    expect(pages).toHaveLength(PUBLISHED_LOCALES.length);
    expect(pages[0]!.url).toBe(`${SITE_URL}/`);
    for (const page of pages) expect(page.url.startsWith(SITE_URL)).toBe(true);
  });

  it('allows the whole site and points at the sitemap', () => {
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE_URL}/sitemap.xml` });
  });

  it('describes the person with the same facts the page shows', () => {
    const html = renderWithMessages(<PersonJsonLd />);
    const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(html)![1]!;
    const person = JSON.parse(json) as Record<string, unknown>;
    const hero = messagesFor('en').hero as MessageTree;

    expect(person['@type']).toBe('Person');
    expect(person.name).toBe(hero.name);
    expect(person.url).toBe(SITE_URL);
    expect(person.email).toBe(EMAIL);
    expect(person.sameAs).toEqual([LINKS.github, LINKS.linkedin]);
    expect(json).not.toContain('<');
  });
});
