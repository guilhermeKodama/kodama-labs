import type { Currency } from '@/types';

/**
 * Common currencies with their details
 */
export const COMMON_CURRENCIES: Omit<Currency, 'manualRate' | 'updatedAt'>[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'ARS$' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COP$' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
];

/**
 * Get currency details by code
 */
export function getCurrencyByCode(
  code: string
): Omit<Currency, 'manualRate' | 'updatedAt'> | undefined {
  return COMMON_CURRENCIES.find((c) => c.code === code);
}

/**
 * Create a currency with default rate
 */
export function createCurrency(
  code: string,
  manualRate: number = 1
): Currency | undefined {
  const currencyInfo = getCurrencyByCode(code);
  if (!currencyInfo) return undefined;

  return {
    ...currencyInfo,
    manualRate,
    updatedAt: new Date(),
  };
}

/**
 * Convert amount between currencies
 */
export function convertCurrency(
  amount: number,
  fromRate: number,
  toRate: number
): number {
  // First convert to base currency, then to target currency
  const baseAmount = amount * fromRate;
  return baseAmount / toRate;
}

/**
 * Convert an amount from a given currency to the user's base currency.
 *
 * manualRate means "1 base = X this currency", so:
 *   amountInBase = amount / manualRate
 *
 * If the currency is already the base, or no rate is found, returns the amount as-is.
 */
export function convertToBaseCurrency(
  amount: number,
  holdingCurrency: string,
  currencies: Currency[],
  baseCurrency: string
): number {
  if (holdingCurrency === baseCurrency) return amount;

  const curr = currencies.find((c) => c.code === holdingCurrency);
  if (!curr || curr.manualRate <= 0) return amount; // fallback: no conversion

  return amount / curr.manualRate;
}

/**
 * Convert a money amount into the user's base currency.
 *
 * `manualRate` means "1 unit of baseCurrency = X units of this currency".
 * Frankfurter is queried as `?base=${baseCurrency}&symbols=foreign`, and that
 * rate is stored on the currencies table. `convertToBaseCurrency` therefore
 * divides: `amountInBase = amount / manualRate`.
 *
 * Worked example: base BRL, USD `manualRate` 0.2 (1 BRL = 0.2 USD).
 * 20 USD / 0.2 = 100 BRL.
 *
 * A stored `exchangeRate` is the inverse (base currency per 1 foreign unit),
 * the same value regular transactions persist (`exchangeRate = 1 / manualRate`).
 * When it is passed, it wins and today's `manualRate` is not applied:
 * `amountInBase = amount * exchangeRate`.
 * A USD expense stored with `exchangeRate` 5.5 stays `amount * 5.5` even when
 * today's USD `manualRate` is 0.2.
 *
 * Omit `exchangeRate` for statement purchases and legacy bill rows. Those have
 * no stored rate, so they convert with today's `manualRate`.
 */
export function amountInUserBase(input: {
  amount: number;
  currency: string;
  exchangeRate?: number | null;
  currencies: Currency[];
  baseCurrency: string;
}): number {
  if (input.exchangeRate != null) return input.amount * input.exchangeRate;
  return convertToBaseCurrency(
    input.amount,
    input.currency,
    input.currencies,
    input.baseCurrency
  );
}

/**
 * Format currency code for display
 */
export function formatCurrencyCode(code: string): string {
  const currency = getCurrencyByCode(code);
  return currency ? `${currency.symbol} ${code}` : code;
}

/**
 * Get default currencies for a new user
 */
export function getDefaultCurrencies(baseCurrency: string): Currency[] {
  const currencies: Currency[] = [];
  
  // Always include base currency with rate 1
  const baseCurrencyInfo = getCurrencyByCode(baseCurrency);
  if (baseCurrencyInfo) {
    currencies.push({
      ...baseCurrencyInfo,
      manualRate: 1,
      updatedAt: new Date(),
    });
  }

  // Add USD if not base currency
  if (baseCurrency !== 'USD') {
    const usd = getCurrencyByCode('USD');
    if (usd) {
      currencies.push({
        ...usd,
        manualRate: 1, // User will need to set this
        updatedAt: new Date(),
      });
    }
  }

  return currencies;
}
