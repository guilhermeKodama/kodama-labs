import { getRequestConfig } from 'next-intl/server';
import { combineNamespaces, mergeMessages, NAMESPACES, type MessageTree } from './messages';
import { isLocale, routing, type Locale } from './routing';

async function loadLocale(locale: Locale): Promise<MessageTree> {
  const files = await Promise.all(
    NAMESPACES.map(async (namespace) => [namespace, (await import(`../messages/${locale}/${namespace}.json`)).default as MessageTree] as const),
  );
  return combineNamespaces(Object.fromEntries(files));
}

export default getRequestConfig(async ({ requestLocale }) => {
  // The [locale] segment, which the middleware fills from the NEXT_LOCALE cookie.
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  const messages = await loadLocale(locale);

  return {
    locale,
    // A key that is still missing in English shows the pt-BR text instead
    // of its raw path (the parity test keeps both languages complete).
    messages: locale === routing.defaultLocale ? messages : mergeMessages(await loadLocale(routing.defaultLocale), messages),
  };
});
