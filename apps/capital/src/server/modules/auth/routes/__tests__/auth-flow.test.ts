import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { LOCALE_COOKIE_NAME } from "@capital/server/i18n";
import { SESSION_COOKIE_NAME } from "../../constants";
import { signupIsOpen } from "../../lib/signup-gate";

/**
 * The sign-up and sign-in routes with sign-up open (the suite's default):
 * the account they create, the session and language cookies they set, how
 * the language is chosen, and what a wrong sign-in tells the visitor.
 */

const PASSWORD = "secret-123";
const EMAILS = ["auth-flow-a@example.com", "auth-flow-b@example.com", "auth-flow-c@example.com", "auth-flow-d@example.com", "auth-flow-e@example.com"];
const app = createApp();
let ipCounter = 0;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": `10.9.8.${++ipCounter}`, ...headers },
    body: JSON.stringify(body),
  });

/** The value of a cookie in the response's Set-Cookie headers, or undefined when it is not set. */
function cookieOf(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(header);
    if (m) return m[1];
  }
  return undefined;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

describe("sign-up gate", () => {
  it("is open in the test suite, as the route tests need", () => {
    expect(signupIsOpen()).toBe(true);
  });
});

describe("POST /v2/auth/signup", () => {
  it("creates the account with its seed data, signs the user in and sets the session and language cookies", async () => {
    const res = await post("/v2/auth/signup", { email: EMAILS[0], password: PASSWORD, name: "Ana", baseCurrency: "usd", locale: "en" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: EMAILS[0], name: "Ana", baseCurrency: "USD", locale: "en" });
    expect(body).not.toHaveProperty("passwordHash");

    const sessionId = cookieOf(res, SESSION_COOKIE_NAME);
    expect(sessionId).toBeTruthy();
    expect(cookieOf(res, LOCALE_COOKIE_NAME)).toBe("en");
    expect(res.headers.getSetCookie().find((h) => h.startsWith(`${SESSION_COOKIE_NAME}=`))).toMatch(/HttpOnly/i);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId! } })).userId).toBe(body.id);

    // The seed: the personal entity with its main account, currencies, categories.
    expect(await prisma.entity.count({ where: { userId: body.id, kind: "personal" } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: body.id, isDefault: true } })).toBe(1);
    expect((await prisma.currency.findMany({ where: { userId: body.id } })).map((c) => c.code)).toContain("USD");
    expect(await prisma.category.count({ where: { userId: body.id } })).toBeGreaterThan(0);

    const me = await app.request("/api/v2/me", { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: body.id, baseCurrency: "USD" });
  });

  it("takes the language from the form, else the language cookie, else Accept-Language, else Portuguese", async () => {
    const localeOf = async (n: number, headers: Record<string, string>, extra: object = {}) => {
      const res = await post("/v2/auth/signup", { email: EMAILS[n], password: PASSWORD, name: "X", ...extra }, headers);
      expect(res.status).toBe(200);
      return [(await res.json()).locale, cookieOf(res, LOCALE_COOKIE_NAME)];
    };
    expect(await localeOf(0, { "accept-language": "pt-BR", cookie: `${LOCALE_COOKIE_NAME}=pt-BR` }, { locale: "en" })).toEqual(["en", "en"]);
    expect(await localeOf(1, { "accept-language": "pt-BR", cookie: `${LOCALE_COOKIE_NAME}=en` })).toEqual(["en", "en"]);
    expect(await localeOf(2, { "accept-language": "en-US,en;q=0.9" })).toEqual(["en", "en"]);
    expect(await localeOf(3, {})).toEqual(["pt-BR", "pt-BR"]);
  });

  it("answers 409 for an email already registered, and 422 for a password that is too short", async () => {
    expect((await post("/v2/auth/signup", { email: EMAILS[0], password: PASSWORD, name: "Ana" })).status).toBe(200);
    const again = await post("/v2/auth/signup", { email: EMAILS[0], password: PASSWORD, name: "Outra" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "auth.email_taken" });
    expect(await prisma.user.count({ where: { email: EMAILS[0] } })).toBe(1);
    expect((await post("/v2/auth/signup", { email: EMAILS[1], password: "short", name: "X" })).status).toBe(422);
  });
});

describe("POST /v2/auth/login", () => {
  async function register(email: string, locale: "en" | "pt-BR") {
    const res = await post("/v2/auth/signup", { email, password: PASSWORD, name: "Bia", locale });
    return (await res.json()).id as string;
  }

  it("signs in with the right password: a new session cookie, the user's language cookie, no password hash", async () => {
    const id = await register(EMAILS[0], "en");
    const res = await post("/v2/auth/login", { email: EMAILS[0], password: PASSWORD }, { cookie: `${LOCALE_COOKIE_NAME}=pt-BR` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, email: EMAILS[0], locale: "en" });
    const sessionId = cookieOf(res, SESSION_COOKIE_NAME);
    expect(sessionId).toBeTruthy();
    expect(cookieOf(res, LOCALE_COOKIE_NAME)).toBe("en");
    expect(await prisma.session.count({ where: { id: sessionId!, userId: id } })).toBe(1);
  });

  it("answers 401 with the same message for a wrong password and for an email nobody has", async () => {
    await register(EMAILS[0], "pt-BR");
    const wrong = await post("/v2/auth/login", { email: EMAILS[0], password: "not-it" });
    const unknown = await post("/v2/auth/login", { email: "nobody-here@example.com", password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: "Invalid email or password", code: "auth.invalid_credentials" });
      expect(cookieOf(res, SESSION_COOKIE_NAME)).toBeUndefined();
    }
  });

  it("forgets the failed attempts of an address once it signs in", async () => {
    await register(EMAILS[0], "pt-BR");
    const headers = { "cf-connecting-ip": "10.77.0.1" };
    for (let i = 0; i < 3; i++) expect((await post("/v2/auth/login", { email: EMAILS[0], password: "wrong" }, headers)).status).toBe(401);
    expect((await post("/v2/auth/login", { email: EMAILS[0], password: PASSWORD }, headers)).status).toBe(200);
    // The count started over: the failures before the success no longer add up.
    for (let i = 0; i < 4; i++) expect((await post("/v2/auth/login", { email: EMAILS[0], password: "wrong" }, headers)).status).toBe(401);
  });
});
