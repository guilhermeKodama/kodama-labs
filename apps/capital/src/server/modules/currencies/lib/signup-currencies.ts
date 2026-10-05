import type { Locale } from "@capital/server/i18n";
import { round } from "@capital/server/modules/ledger/lib/money";

/** Currencies every new user starts with, besides the base currency. */
export const SIGNUP_CURRENCY_CODES = ["BRL", "USD", "EUR"] as const;

/**
 * Starting rates in BRL per unit (the mockup's PTAX). They only make a new
 * user's currencies convert sensibly until the daily FX update or the user
 * replaces them.
 */
const BRL_PER_UNIT: Readonly<Record<string, number>> = { BRL: 1, USD: 5.41, EUR: 6.02 };

/** The locale's name for a currency ("Dólar americano", "US Dollar"); the code when Intl does not know it. */
export function currencyName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The locale's symbol for a currency ("US$" in pt-BR, "$" in en); the code when Intl does not know it. */
export function currencySymbol(code: string, locale: Locale): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency: code }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/**
 * The Currency rows a new user starts with: the base currency at rate 1 and
 * BRL, USD and EUR, each with manualRate in units per one unit of the base
 * currency (how loadFx reads it: 1 USD = 5.41 BRL is manualRate 0.184843 on
 * a BRL base). A base outside that list has no rate to derive the others
 * from, so only the base is seeded. Names and symbols follow the locale.
 * The starting rates are placeholders, so they carry the source the daily FX
 * update fills them from (PTAX on a BRL base, else ECB), not "manual", which
 * the update leaves alone.
 */
export function signupCurrencies(baseCurrency: string, locale: Locale) {
  const base = baseCurrency.toUpperCase();
  const brlPerBase = BRL_PER_UNIT[base];
  const codes = brlPerBase === undefined ? [base] : [...new Set([base, ...SIGNUP_CURRENCY_CODES])];
  const source = base === "BRL" ? "ptax" : "ecb";
  return codes.map((code) => ({
    code,
    name: currencyName(code, locale),
    symbol: currencySymbol(code, locale),
    manualRate: code === base ? 1 : round(brlPerBase / BRL_PER_UNIT[code], 6),
    source,
  }));
}
