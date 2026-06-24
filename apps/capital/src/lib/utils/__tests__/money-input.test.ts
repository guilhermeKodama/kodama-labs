import { describe, it, expect } from 'vitest';
import { formatMoneyInput, parseMoneyDigits, localeForCurrency } from '../format';

describe('parseMoneyDigits (cents mask)', () => {
  it('reads digits as cents, filling from the right', () => {
    expect(parseMoneyDigits('')).toBe(0);
    expect(parseMoneyDigits('5')).toBe(0.05);
    expect(parseMoneyDigits('50')).toBe(0.5);
    expect(parseMoneyDigits('806')).toBe(8.06);
    expect(parseMoneyDigits('8065636')).toBe(80656.36);
  });

  it('ignores any non-digit (separators, letters, pasted formatting)', () => {
    expect(parseMoneyDigits('80.656,36')).toBe(80656.36);
    expect(parseMoneyDigits('R$ 1.000,00')).toBe(1000);
    expect(parseMoneyDigits('abc')).toBe(0);
    expect(parseMoneyDigits('0008')).toBe(0.08);
  });
});

describe('formatMoneyInput', () => {
  it('always shows 2 decimals with locale grouping', () => {
    expect(formatMoneyInput(80656.36, 'pt-BR')).toBe('80.656,36');
    expect(formatMoneyInput(80656.36, 'en-US')).toBe('80,656.36');
    expect(formatMoneyInput(0.05, 'pt-BR')).toBe('0,05');
    expect(formatMoneyInput(1000, 'pt-BR')).toBe('1.000,00');
  });

  it('round-trips through the cents mask', () => {
    const formatted = formatMoneyInput(1234.56, 'pt-BR');
    expect(parseMoneyDigits(formatted)).toBe(1234.56);
  });
});

describe('localeForCurrency', () => {
  it('maps a currency to its number-formatting locale', () => {
    expect(localeForCurrency('BRL')).toBe('pt-BR');
    expect(localeForCurrency('USD')).toBe('en-US');
    expect(localeForCurrency('XYZ')).toBe('en-US');
  });
});
