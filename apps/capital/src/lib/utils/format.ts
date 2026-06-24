import { format, formatDistanceToNow } from 'date-fns';

/**
 * Format a number as currency
 */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(
  value: number,
  locale: string = 'en-US',
  decimals: number = 2
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a date
 */
export function formatDate(
  date: Date | string,
  formatStr: string = 'MMM d, yyyy'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, formatStr);
}

/**
 * Format a date as relative time (e.g., "2 days ago")
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number,
  locale: string = 'en-US',
  decimals: number = 1
): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);
}

/**
 * Format a compact number (e.g., 1.2K, 3.4M)
 */
export function formatCompactNumber(
  value: number,
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
  }).format(value);
}

/**
 * Format an exchange rate with up to 6 decimal places (financial industry standard).
 * Trailing zeros are trimmed for cleaner display (e.g., 1.25 instead of 1.250000).
 */
export function formatRate(
  rate: number,
  locale: string = 'en-US',
  maxDecimals: number = 6
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(rate);
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: string, locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency;
}

// ============================================
// Money input helpers (shared by CurrencyInput)
// ============================================

const CURRENCY_LOCALES: Record<string, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  CAD: 'en-CA',
  AUD: 'en-AU',
  CHF: 'de-CH',
  CNY: 'zh-CN',
};

/**
 * The number-formatting locale that matches a currency's conventions, so an
 * amount renders the way speakers of that currency expect regardless of the UI
 * language (e.g. BRL always uses "1.234,56").
 */
export function localeForCurrency(currency: string): string {
  return CURRENCY_LOCALES[currency] ?? 'en-US';
}

/**
 * Format a number for a money input: always exactly 2 decimals with locale
 * grouping and decimal separator (e.g. 80656.36 -> "80.656,36" in pt-BR).
 */
export function formatMoneyInput(value: number, locale: string = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Interpret raw input as a "cents mask": keep only digits and read them as an
 * integer number of cents, so typing "8065636" yields 80656.36. Non-digits
 * (separators, letters, pasted formatting) are ignored.
 */
export function parseMoneyDigits(input: string): number {
  const digits = input.replace(/\D/g, '');
  if (!digits) return 0;
  return Number((parseInt(digits, 10) / 100).toFixed(2));
}
