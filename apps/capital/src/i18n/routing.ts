import { defineRouting } from 'next-intl/routing';

/** Name of the cookie that holds the UI language (the server sets it at login, signup and PATCH /v2/me). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** One year, like the cookie the server writes. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const routing = defineRouting({
  locales: ['pt-BR', 'en'],

  defaultLocale: 'pt-BR',

  // URLs never carry the locale. It comes from the NEXT_LOCALE cookie,
  // else pt-BR: the middleware hides Accept-Language from next-intl, so a
  // browser in English still opens in Portuguese until the user (or their
  // saved User.locale, see LocaleSync) picks English. A prefixed URL
  // (/en/transactions) switches the cookie and redirects to /transactions.
  localePrefix: 'never',

  localeCookie: { name: LOCALE_COOKIE, maxAge: LOCALE_COOKIE_MAX_AGE },
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}
