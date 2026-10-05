"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/routing";
import { useSession } from "@/lib/api/session";
import { readCookie, savedLocaleAction } from "@/lib/shell/locale";

/**
 * Applies the user's saved language (User.locale) in a browser without
 * the NEXT_LOCALE cookie, which otherwise decides (lib/shell/locale.ts).
 * Switching goes through next-intl's router: it writes the cookie and
 * reloads the route in the other language.
 */
export function LocaleSync() {
  const saved = useSession().data?.locale;
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const action = savedLocaleAction(saved, readCookie(document.cookie, LOCALE_COOKIE), active);
    if (!action) return;
    if (action.switch) {
      router.replace(`${pathname}${window.location.search}`, { locale: action.locale });
    } else {
      document.cookie = `${LOCALE_COOKIE}=${action.locale}; path=/; samesite=lax; max-age=${LOCALE_COOKIE_MAX_AGE}`;
    }
  }, [saved, active, pathname, router]);

  return null;
}
