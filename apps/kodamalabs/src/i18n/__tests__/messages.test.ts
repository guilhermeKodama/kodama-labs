import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, KNOWN_LOCALES, PUBLISHED_LOCALES } from '../locales';
import { NAMESPACES } from '../messages';

const MESSAGES_DIR = path.resolve(__dirname, '../../messages');

function readNamespace(locale: string, namespace: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'));
}

/** Flattens a message tree to "a.b.c" → string. */
function leaves(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`Message "${prefix}" must be a string or an object of messages.`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.includes('.')) throw new Error(`Message key "${key}" must not contain a dot.`);
    for (const [leafKey, leafValue] of leaves(value, prefix ? `${prefix}.${key}` : key)) {
      out.set(leafKey, leafValue);
    }
  }
  return out;
}

/** Names of ICU arguments and rich-text tags used by a message. */
function placeholders(message: string): string[] {
  const args = [...message.matchAll(/\{\s*([a-zA-Z0-9_]+)/g)].map((match) => `{${match[1]}}`);
  const tags = [...message.matchAll(/<([a-zA-Z0-9_]+)>/g)].map((match) => `<${match[1]}>`);
  return [...new Set([...args, ...tags])].sort();
}

function allMessages(locale: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const namespace of NAMESPACES) {
    for (const [key, value] of leaves(readNamespace(locale, namespace), namespace)) {
      out.set(key, value);
    }
  }
  return out;
}

describe('messages', () => {
  it('publishes the default locale and only known locales', () => {
    expect(PUBLISHED_LOCALES).toContain(DEFAULT_LOCALE);
    for (const locale of PUBLISHED_LOCALES) expect(KNOWN_LOCALES).toContain(locale);
  });

  it('has exactly one file per namespace in every published locale', () => {
    for (const locale of PUBLISHED_LOCALES) {
      const files = fs.readdirSync(path.join(MESSAGES_DIR, locale)).sort();
      expect(files, locale).toEqual(NAMESPACES.map((namespace) => `${namespace}.json`).sort());
    }
  });

  it('never ships a bracketed placeholder', () => {
    // Facts only the owner has are data in src/content/facts.ts. A row whose
    // fact is unknown is not rendered; "[LIKE THIS]" must not reach the page.
    for (const locale of PUBLISHED_LOCALES) {
      for (const [key, value] of allMessages(locale)) {
        expect(value, `${locale}:${key}`).not.toMatch(/\[[A-Z][^\]]*\]/);
      }
    }
  });

  it('keeps every published locale in step with the default one', () => {
    const source = allMessages(DEFAULT_LOCALE);
    for (const locale of PUBLISHED_LOCALES) {
      if (locale === DEFAULT_LOCALE) continue;
      const target = allMessages(locale);
      expect([...target.keys()].sort(), locale).toEqual([...source.keys()].sort());
      for (const [key, value] of source) {
        expect(placeholders(target.get(key) ?? ''), `${locale}:${key}`).toEqual(placeholders(value));
      }
    }
  });
});
