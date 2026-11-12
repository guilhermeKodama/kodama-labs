import { useLocale } from 'next-intl';

import { ENDONYMS, PUBLISHED_LOCALES, localeHref } from '@/i18n/locales';

/**
 * A text link to the other language, named in that language. It is a plain
 * link with a full page load, because <html lang> changes with it.
 *
 * Renders nothing while only one locale is published, so the page never shows
 * a language link that leads nowhere.
 */
export function LanguageLink() {
  const current = useLocale();
  const other = PUBLISHED_LOCALES.find((locale) => locale !== current);
  if (!other) return null;

  return (
    <a href={localeHref(other)} lang={other} hrefLang={other}>
      {ENDONYMS[other]}
    </a>
  );
}
