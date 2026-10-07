import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { HttpError } from "@capital/server/lib/http-error";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, LOCALES, matchLocale, negotiateLocale, resolveLocale, type Locale } from "@capital/server/i18n";
import { jsonBody, toHttp, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { DATE_FORMATS, NUMBER_FORMATS, TEXT_SIZES, THEMES, normalizeNumberFormat } from "@capital/server/modules/users/lib/preferences";
import { getMe, serializeUser, updatePreferences } from "@capital/server/modules/users/services/me";
import { SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from "../../constants";
import { login } from "../../services/login";
import { createSession, deleteSession } from "../../services/session";
import { signup } from "../../services/signup";

const tags = ["Auth v2"];
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_EXPIRY_DAYS,
  });
}

/** Keeps the UI (next-intl reads this cookie) in the user's saved language; readable by the client, which switches it too. */
function setLocaleCookie(c: Context, locale: string) {
  setCookie(c, LOCALE_COOKIE_NAME, resolveLocale(locale), { path: "/", sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE });
}

/** A new account's locale: the one the signup form sends, else the UI's locale cookie, else Accept-Language, else pt-BR. */
function signupLocale(c: Context, requested: Locale | undefined): Locale {
  return requested ?? matchLocale(getCookie(c, LOCALE_COOKIE_NAME)) ?? negotiateLocale(c.req.header("accept-language")) ?? DEFAULT_LOCALE;
}

const loginRoute = createRoute({
  method: "post",
  path: "/v2/auth/login",
  tags,
  summary: "Log in with email and password",
  request: jsonBody(z.object({ email: z.string().email(), password: z.string().min(1) })),
  responses: v2Responses,
});
const signupRoute = createRoute({
  method: "post",
  path: "/v2/auth/signup",
  tags,
  summary: "Create an account (PF entity, main account, categories, currencies, built-in view)",
  request: jsonBody(
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      baseCurrency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
      /** UI language; without it the locale cookie or Accept-Language decides. Names the server writes (categories, views) follow it. */
      locale: z.enum(LOCALES).optional(),
    })
  ),
  responses: v2Responses,
});
const logoutRoute = createRoute({ method: "post", path: "/v2/auth/logout", tags, summary: "End the session", responses: v2Responses });
const meRoute = createRoute({ method: "get", path: "/v2/me", tags, summary: "Current user, preferences and entities", responses: v2Responses });
const patchMeRoute = createRoute({
  method: "patch",
  path: "/v2/me",
  tags,
  summary: "Update preferences",
  request: jsonBody(
    z
      .object({
        name: z.string().min(1).optional(),
        baseCurrency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
        theme: z.enum(THEMES).optional(),
        /** UI text size: sm (Pequeno), md (Médio) or lg (Grande). */
        textSize: z.enum(TEXT_SIZES).optional(),
        dateFormat: z.enum(DATE_FORMATS).optional(),
        /** pt-BR (1.234,56) or en-US (1,234.56); the older "1.234,56" / "1,234.56" spellings are accepted and stored as those. */
        numberFormat: z.preprocess((v) => (typeof v === "string" ? normalizeNumberFormat(v) ?? v : v), z.enum(NUMBER_FORMATS)).optional(),
        timezone: z.string().min(1).optional(),
        locale: z.enum(LOCALES).optional(),
        fxAutoUpdate: z.boolean().optional(),
        /** Change the base currency even though entries exist (their base amounts keep the old currency). */
        force: z.boolean().optional(),
      })
      .strict()
  ),
  responses: v2Responses,
});

export const v2Auth = createRouter()
  .openapi(loginRoute, async (c) => {
    try {
      const user = await login(c.req.valid("json"), prisma);
      setSessionCookie(c, await createSession(user.id, prisma));
      setLocaleCookie(c, user.locale);
      return c.json(serializeUser(user) as never, 200);
    } catch {
      throw new HttpError(401, "Invalid email or password", { code: "auth.invalid_credentials" });
    }
  })
  .openapi(signupRoute, async (c) => {
    try {
      const body = c.req.valid("json");
      const user = await signup({ ...body, locale: signupLocale(c, body.locale) }, prisma);
      setSessionCookie(c, await createSession(user.id, prisma));
      setLocaleCookie(c, user.locale);
      return c.json(serializeUser(user) as never, 200);
    } catch (err) {
      throw toHttp(err);
    }
  })
  .openapi(logoutRoute, async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);
    if (sessionId) await deleteSession(sessionId, prisma);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ success: true } as never, 200);
  })
  .openapi(meRoute, v2Handler(meRoute, async (_c, userId) => getMe(userId, prisma)))
  .openapi(patchMeRoute, v2Handler(patchMeRoute, async (c, userId) => {
    const { force, ...patch } = c.req.valid("json");
    const user = await updatePreferences(userId, patch, prisma, { force });
    if (patch.locale) setLocaleCookie(c, user.locale);
    return user;
  }));
