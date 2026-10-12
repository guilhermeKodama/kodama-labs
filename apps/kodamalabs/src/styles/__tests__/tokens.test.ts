import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, '../tokens.css'), 'utf8');

function block(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of source.matchAll(/(--kl-[a-z-]+):\s*(#[0-9a-f]{6})/g)) {
    tokens.set(match[1]!, match[2]!);
  }
  return tokens;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = block(css.slice(0, darkStart));
const dark = block(css.slice(darkStart));

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour tokens', () => {
  it('defines the same tokens in both schemes', () => {
    expect(light.size).toBeGreaterThan(0);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps text and the accent readable in the %s scheme', (_name, tokens) => {
    // AA for normal text. `soft` is for construction lines only and is
    // deliberately not in this list; it must never colour text.
    for (const surface of ['--kl-ground', '--kl-panel']) {
      for (const text of ['--kl-ink', '--kl-muted', '--kl-accent']) {
        const ratio = contrast(tokens.get(text)!, tokens.get(surface)!);
        expect(ratio, `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
