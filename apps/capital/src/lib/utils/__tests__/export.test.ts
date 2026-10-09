import { describe, expect, it } from 'vitest';
import { escapeCSV } from '../export';

describe('escapeCSV', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)'])('prefixes %s', (value) => {
    expect(escapeCSV(value)).toBe(`'${value}`);
  });

  it('leaves normal text unchanged', () => {
    expect(escapeCSV('Groceries')).toBe('Groceries');
  });

  it('leaves negative numbers unchanged', () => {
    expect(escapeCSV(-5)).toBe('-5');
  });

  it('leaves numeric strings unchanged', () => {
    expect(escapeCSV('-12.30')).toBe('-12.30');
    expect(escapeCSV('12.30')).toBe('12.30');
  });

  it('returns empty string for undefined and null', () => {
    expect(escapeCSV(undefined)).toBe('');
    expect(escapeCSV(null as unknown as undefined)).toBe('');
  });

  it('prefixes before quoting', () => {
    expect(escapeCSV('=a,"b"')).toBe(`"'=a,""b"""`);
    expect(escapeCSV('=A,B')).toBe(`"'=A,B"`);
  });

  it('does not double-prefix', () => {
    expect(escapeCSV("'=x")).toBe("'=x");
  });
});
