import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, localeHref } from '@/i18n/locales';

import { FONT_VARIABLES } from './fonts';

import './globals.css';

// Rendered for any path that matches no route. It sits outside [locale], so it
// brings its own document; it speaks the default language.
export default async function NotFound() {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: 'site.notFound' });

  return (
    <html lang={DEFAULT_LOCALE} className={FONT_VARIABLES}>
      <body className="font-text text-body">
        <main className="kl-container flex min-h-dvh flex-col justify-center gap-4.5">
          <h1 className="font-display text-h2-sm font-normal">{t('title')}</h1>
          <p>
            <a href={localeHref(DEFAULT_LOCALE)}>{t('back')}</a>
          </p>
        </main>
      </body>
    </html>
  );
}
