import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, PUBLISHED_LOCALES } from './locales';

export const routing = defineRouting({
  locales: PUBLISHED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // English at "/", other locales under their prefix.
  localePrefix: 'as-needed',
  // The URL decides the language. No redirect on a guessed language, no cookie.
  localeDetection: false,
  localeCookie: false,
});
