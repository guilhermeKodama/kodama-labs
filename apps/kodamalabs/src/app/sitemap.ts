import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/content/links';
import { PUBLISHED_LOCALES, localeHref } from '@/i18n/locales';

/** One page per published language, each pointing at the others. */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(PUBLISHED_LOCALES.map((locale) => [locale, SITE_URL + localeHref(locale)]));

  return PUBLISHED_LOCALES.map((locale) => ({
    url: SITE_URL + localeHref(locale),
    changeFrequency: 'monthly',
    priority: 1,
    alternates: { languages },
  }));
}
