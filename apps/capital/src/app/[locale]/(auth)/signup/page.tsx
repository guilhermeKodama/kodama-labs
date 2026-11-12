import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { SignupClosed } from "@/components/auth/signup-closed";
import { isLocale, routing } from "@/i18n/routing";
import { BRAND } from "@/lib/brand";
import { signupIsOpen } from "@capital/server/modules/auth/lib/signup-gate";

// SIGNUP_OPEN is read per request, not frozen into the build.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : routing.defaultLocale, namespace: "auth.signup" });
  return { title: `${t("title")} · ${BRAND}` };
}

export default function SignupPage() {
  return signupIsOpen() ? <CredentialsForm mode="signup" /> : <SignupClosed />;
}
