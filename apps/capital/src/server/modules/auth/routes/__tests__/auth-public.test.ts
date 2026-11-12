import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { MAX_FAILURES_PER_ACCOUNT } from "@capital/server/modules/auth/lib/login-throttle";
import { signup } from "@capital/server/modules/auth/services/signup";

// The default: sign-up closed (SIGNUP_OPEN unset or "false"). The rest of the suite opens it.
vi.mock("@capital/server/modules/auth/lib/signup-gate", () => ({ signupIsOpen: () => false }));

/** The sign-in routes as the internet sees them once Cloudflare Access is gone. */
const EMAIL = "auth-public-test@example.com";
const PASSWORD = "secret-123";
const app = createApp();

async function call(path: string, body: unknown, ip: string) {
  const res = await app.request(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.json() };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, "someone-new@example.com"] } } });
  await signup({ email: EMAIL, password: PASSWORD, name: "Auth public", locale: "pt-BR" }, prisma);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, "someone-new@example.com"] } } });
});

describe("public auth routes", () => {
  it("refuses new accounts while sign-up is closed", async () => {
    const res = await call("/v2/auth/signup", { email: "someone-new@example.com", password: PASSWORD, name: "New" }, "5.5.5.5");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Sign-up is closed", code: "auth.signup_closed" });
    expect(await prisma.user.count({ where: { email: "someone-new@example.com" } })).toBe(0);
  });

  it("makes an address wait after repeated wrong passwords, even for the right one", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) {
      expect((await call("/v2/auth/login", { email: EMAIL, password: "wrong" }, "6.6.6.6")).status).toBe(401);
    }
    const blocked = await call("/v2/auth/login", { email: EMAIL, password: PASSWORD }, "6.6.6.6");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: "Too many failed sign-in attempts", code: "auth.too_many_attempts", params: { minutes: 15 } });
    expect(Number(blocked.retryAfter)).toBeGreaterThan(800);
    // Another address signs in normally.
    expect((await call("/v2/auth/login", { email: EMAIL, password: PASSWORD }, "7.7.7.7")).status).toBe(200);
  });
});
