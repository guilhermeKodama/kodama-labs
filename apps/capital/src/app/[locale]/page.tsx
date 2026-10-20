import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomePage } from "@/components/home/home-page";
import { isLocale, routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : routing.defaultLocale, namespace: "home.meta" });
  return { title: t("title"), description: t("description") };
}

/** `/` without a session (the middleware sends a signed-in visitor on to /transactions). */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(isLocale(locale) ? locale : routing.defaultLocale);
  return <HomePage />;
}
