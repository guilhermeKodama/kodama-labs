import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Toaster } from "sonner";
import { PageLayout } from "@/components/page-layout";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Every page under [locale] reads live data straight from Postgres — force
// dynamic rendering so `next build` doesn't attempt to prerender them (which
// requires a reachable DB at build time; the Docker build stage has none).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
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

  if (
    !routing.locales.includes(locale as (typeof routing.locales)[number])
  ) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <PageLayout>{children}</PageLayout>
      <Toaster />
    </NextIntlClientProvider>
  );
}
