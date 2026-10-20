import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { isLocale, routing } from "@/i18n/routing";
import { BRAND } from "@/lib/brand";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : routing.defaultLocale, namespace: "auth.signup" });
  return { title: `${t("title")} · ${BRAND}` };
}

export default function SignupPage() {
  return <CredentialsForm mode="signup" />;
}
