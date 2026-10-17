import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, isPublishedLocale } from './locales';
import { loadMessages } from './messages';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isPublishedLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
