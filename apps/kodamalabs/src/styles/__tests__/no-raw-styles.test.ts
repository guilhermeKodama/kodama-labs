import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The design has one small token layer (src/styles). Components may only use
 * the names it declares: no colour literal, no Tailwind palette class and no
 * ad-hoc font size anywhere else. The same idea as the convention tests in
 * apps/capital/src/lib/__tests__.
 */
const SRC = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(SRC).map((file) => ({
  name: path.relative(SRC, file),
  lines: fs.readFileSync(file, 'utf8').split('\n'),
}));

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
const PALETTE_CLASS =
  /\b(?:bg|text|border|fill|stroke|ring|outline|decoration|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;
const RAW_TEXT_SIZE =
  /\btext-\[[\d.]+(?:px|rem|em)\]|\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\bfontSize\s*[:=]|font-size\s*:/;

function offenders(pattern: RegExp, allowed: (name: string) => boolean): string[] {
  return files
    .filter((file) => !allowed(file.name))
    .flatMap((file) =>
      file.lines.flatMap((line, index) =>
        pattern.test(line) ? [`${file.name}:${index + 1}  ${line.trim()}`] : [],
      ),
    );
}

describe('token layer', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('keeps colour literals in styles/tokens.css', () => {
    expect(offenders(COLOUR_LITERAL, (name) => name === 'styles/tokens.css')).toEqual([]);
  });

  it('uses no Tailwind palette class', () => {
    expect(offenders(PALETTE_CLASS, () => false)).toEqual([]);
  });

  it('keeps font sizes in src/styles', () => {
    expect(offenders(RAW_TEXT_SIZE, (name) => name.startsWith('styles/'))).toEqual([]);
  });
});
