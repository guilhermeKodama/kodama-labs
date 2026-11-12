import published from '../messages/published.json';

/** Every locale the site is designed for. English is the source. */
export const KNOWN_LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof KNOWN_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * A locale exists on the site only once its messages are written and it is
 * listed in messages/published.json. Until then it has no route, no hreflang
 * and no language link, so nothing on the page points at a missing page.
 */
export const PUBLISHED_LOCALES: Locale[] = KNOWN_LOCALES.filter((locale) =>
  (published as string[]).includes(locale),
);

/** Each language named in itself, for the language link. */
export const ENDONYMS: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português',
};

export function isPublishedLocale(value: string | undefined): value is Locale {
  return PUBLISHED_LOCALES.some((locale) => locale === value);
}

/** Path of the homepage in a locale, following localePrefix "as-needed". */
export function localeHref(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}`;
}
