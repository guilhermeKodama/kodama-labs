import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'pt-BR'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // Do not auto-redirect to the browser's preferred locale. Root `/` always
  // serves English; Portuguese readers click the toggle to land on `/pt-BR`.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
