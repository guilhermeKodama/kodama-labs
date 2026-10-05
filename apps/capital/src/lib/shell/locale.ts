import { isLocale, type Locale } from "@/i18n/routing";

/**
 * Which language the UI shows. The NEXT_LOCALE cookie decides (the server
 * sets it at login, signup and when the language is saved; the language
 * switch sets it too). Without the cookie, a signed-in user's saved
 * User.locale applies: a session from before the cookie existed, cleared
 * cookies, another browser.
 */

/** Value of one cookie in a `document.cookie` string. */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return value.join("=");
      }
    }
  }
  return null;
}

/**
 * What to do with the user's saved locale: nothing (null), or set the
 * cookie to it, switching the rendered language when it differs from the
 * active one (`switch`).
 */
export function savedLocaleAction(saved: unknown, cookie: string | null, active: string): { locale: Locale; switch: boolean } | null {
  if (isLocale(cookie) || !isLocale(saved)) return null;
  return { locale: saved, switch: saved !== active };
}
