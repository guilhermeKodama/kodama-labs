import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SITE_URL } from '@/content/links';
import { PUBLISHED_LOCALES, isPublishedLocale, localeHref } from '@/i18n/locales';
import { routing } from '@/i18n/routing';
import { MotionRoot } from '@/motion/motion-root';
import { BOOT_SCRIPT, PREPAINT_SCRIPT } from '@/motion/scripts';

import { FONT_VARIABLES } from '../fonts';

import '../globals.css';

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// Only published locales exist; anything else is a 404, never rendered on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isPublishedLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'site.meta' });

  return {
    metadataBase: new URL(SITE_URL),
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: localeHref(locale),
      languages: Object.fromEntries(PUBLISHED_LOCALES.map((other) => [other, localeHref(other)])),
    },
    openGraph: {
      type: 'profile',
      url: localeHref(locale),
      siteName: t('siteName'),
      title: t('title'),
      description: t('description'),
      locale,
    },
    twitter: { card: 'summary_large_image', title: t('title'), description: t('description') },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isPublishedLocale(locale)) notFound();
  setRequestLocale(locale);

  // Two inline scripts bracket the page (see src/motion/scripts.ts): the first
  // decides before paint whether this visit gets motion, the second starts the
  // figures on screen without waiting for hydration. They change attributes
  // React rendered, hence suppressHydrationWarning here and on each figure.
  return (
    <html lang={locale} className={FONT_VARIABLES} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body className="font-text text-body">
        {children}
        <MotionRoot />
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </body>
    </html>
  );
}
