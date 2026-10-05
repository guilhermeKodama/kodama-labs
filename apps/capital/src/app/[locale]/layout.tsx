import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionGate } from '@/components/providers/session-gate';
import { ThemeSync } from '@/components/providers/theme-sync';
import { PwaRegister } from '@/components/pwa-register';
import { routing } from '@/i18n/routing';
import { FormatProvider } from '@/lib/format/provider';
import { ShortcutProvider } from '@/lib/shortcuts/provider';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate locale
  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  // Get messages for the locale
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <NuqsAdapter>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeSync />
          <ShortcutProvider>
            <FormatProvider>
              <SessionGate>
                {children}
              </SessionGate>
            </FormatProvider>
          </ShortcutProvider>
          <Toaster />
          <PwaRegister />
        </ThemeProvider>
      </NuqsAdapter>
    </NextIntlClientProvider>
  );
}
