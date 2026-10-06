import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { isLocale, routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : routing.defaultLocale, namespace: "auth.login" });
  return { title: `${t("title")} · Capital` };
}

export default function LoginPage() {
  return <CredentialsForm mode="login" />;
}
