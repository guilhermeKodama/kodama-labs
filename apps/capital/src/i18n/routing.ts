import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // List of all supported locales
  locales: ['pt-BR', 'en'],

  // Default locale (Portuguese BR)
  defaultLocale: 'pt-BR',

  // Locale prefix strategy
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
