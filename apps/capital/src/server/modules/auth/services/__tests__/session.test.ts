import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { SESSION_COOKIE_NAME, SESSION_EXPIRY_DAYS } from "../../constants";
import { createSession, deleteSession, deleteUserSessions, validateSession } from "../session";

/** Sessions: created for a week, valid until they expire, removed one by one or all at once, and by the logout route. */
const USER = "test-user-auth-session-a";
const OTHER = "test-user-auth-session-b";
const app = createApp();

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const sessionCount = (userId: string) => prisma.session.count({ where: { userId } });
const logout = (cookie?: string) => app.request("/api/v2/auth/logout", { method: "POST", headers: cookie ? { cookie } : {} });

describe("createSession and validateSession", () => {
  it("creates a session that expires in SESSION_EXPIRY_DAYS and identifies its user", async () => {
    const before = Date.now();
    const id = await createSession(USER, prisma);
    const row = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBe(USER);
    const days = (row.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(SESSION_EXPIRY_DAYS - 0.01);
    expect(days).toBeLessThan(SESSION_EXPIRY_DAYS + 0.01);
    expect(await validateSession(id, prisma)).toEqual({ userId: USER });
  });

  it("answers null for a session that does not exist", async () => {
    expect(await validateSession("nao-existe", prisma)).toBeNull();
  });

  it("answers null for an expired session and removes it", async () => {
    const expired = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSession(expired.id, prisma)).toBeNull();
    expect(await prisma.session.count({ where: { id: expired.id } })).toBe(0);
  });
});

describe("deleting sessions", () => {
  it("deleteSession removes that session only, and is quiet about one that is gone", async () => {
    const a = await createSession(USER, prisma);
    const b = await createSession(USER, prisma);
    await deleteSession(a, prisma);
    await deleteSession(a, prisma);
    expect(await validateSession(a, prisma)).toBeNull();
    expect(await validateSession(b, prisma)).toEqual({ userId: USER });
  });

  it("deleteUserSessions removes every session of the user and none of another's", async () => {
    await createSession(USER, prisma);
    await createSession(USER, prisma);
    const others = await createSession(OTHER, prisma);
    await deleteUserSessions(USER, prisma);
    expect(await sessionCount(USER)).toBe(0);
    expect(await validateSession(others, prisma)).toEqual({ userId: OTHER });
  });
});

describe("POST /v2/auth/logout", () => {
  it("ends the session of the cookie, clears the cookie, and the cookie no longer opens the API", async () => {
    const id = await createSession(USER, prisma);
    const other = await createSession(USER, prisma);
    const cookie = `${SESSION_COOKIE_NAME}=${id}`;
    expect((await app.request("/api/v2/me", { headers: { cookie } })).status).toBe(200);

    const res = await logout(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=;.*(Max-Age=0|Expires=)`, "i"));
    expect(await prisma.session.count({ where: { id } })).toBe(0);
    expect(await prisma.session.count({ where: { id: other } })).toBe(1);
    expect((await app.request("/api/v2/me", { headers: { cookie } })).status).toBe(401);
  });

  it("succeeds without a cookie, changing no session", async () => {
    await createSession(USER, prisma);
    const res = await logout();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await sessionCount(USER)).toBe(1);
  });
});
