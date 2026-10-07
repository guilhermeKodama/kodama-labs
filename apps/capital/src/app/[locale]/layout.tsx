import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import '../globals.css';
import { BODY_CLASS } from '../fonts';
import { QueryProvider } from '@/components/providers/query-provider';
import { PwaRegister } from '@/components/pwa-register';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { isLocale, routing } from '@/i18n/routing';
import { TEXT_SIZE_SCRIPT } from '@/lib/theme/text-size';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Pick<LocaleLayoutProps, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : routing.defaultLocale, namespace: 'shell.meta' });
  return {
    title: t('title'),
    description: t('description'),
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Capital' },
    // No `manifest` field here — Next's Metadata API only accepts a string/URL
    // for it, with no way to set crossOrigin. See the <link> below instead.
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

/**
 * The document of every page, in the active language (the [locale]
 * segment, which the middleware fills from the NEXT_LOCALE cookie).
 * Signed-in pages add their providers in the (app) and (settings) layouts.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Enable static rendering
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={BODY_CLASS} suppressHydrationWarning>
        {/* The text size last applied on this device (TextSizeSync stores it), set on <html> before
            the first paint. From localStorage, not a cookie, so this layout stays static. */}
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
        {/* crossOrigin="use-credentials": the whole app sits behind Cloudflare
            Access, and a manifest fetch without cookies gets redirected to the
            Access login page — see manifest.webmanifest/route.ts for the full
            explanation. React 19 hoists this into <head> on its own. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <NextIntlClientProvider messages={messages}>
          <NuqsAdapter>
            <QueryProvider>
              <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
                {children}
                <Toaster />
                <PwaRegister />
              </ThemeProvider>
            </QueryProvider>
          </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
